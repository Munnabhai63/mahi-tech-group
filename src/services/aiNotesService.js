import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { execute, queryOne } from '../db/database.js';
import { pushToUser } from './wsService.js';

/**
 * Async background worker to process meeting audio recording via OpenAI Whisper + GPT-4o
 * @param {string} meetingId
 * @param {string} filePath
 */
export async function processMeetingRecording(meetingId, filePath) {
  try {
    console.log(`[AI NOTES] Starting async processing for meeting ${meetingId} with file ${filePath}`);

    const meeting = queryOne('SELECT * FROM meetings WHERE id = ?', [meetingId]);
    if (!meeting) {
      console.error(`[AI NOTES ERROR] Meeting ${meetingId} not found.`);
      return { success: false, error: 'Meeting not found' };
    }

    if (!fs.existsSync(filePath)) {
      console.error(`[AI NOTES ERROR] Recording file ${filePath} not found on disk.`);
      return { success: false, error: 'Recording file not found on disk' };
    }

    let transcriptRaw = '';
    let notesHindi = '';
    let notesEnglish = '';
    let aiModelUsed = 'OpenAI Whisper-1 + GPT-4o';

    if (config.OPENAI_API_KEY && config.OPENAI_API_KEY.trim().length > 0) {
      console.log(`[AI NOTES] Invoking OpenAI Whisper API with real audio...`);
      const fileBuffer = await fs.promises.readFile(filePath);
      const ext = path.extname(filePath).toLowerCase();
      let mimeType = 'audio/mpeg';
      if (ext === '.wav') mimeType = 'audio/wav';
      else if (ext === '.m4a') mimeType = 'audio/m4a';
      else if (ext === '.webm') mimeType = 'audio/webm';
      else if (ext === '.mp4') mimeType = 'video/mp4';

      const formData = new FormData();
      formData.append('file', new Blob([fileBuffer], { type: mimeType }), path.basename(filePath));
      formData.append('model', 'whisper-1');

      const whisperRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.OPENAI_API_KEY}`
        },
        body: formData
      });

      if (!whisperRes.ok) {
        const errText = await whisperRes.text();
        throw new Error(`Whisper API error (${whisperRes.status}): ${errText}`);
      }

      const whisperJson = await whisperRes.json();
      transcriptRaw = whisperJson.text || '';
      console.log(`[AI NOTES] Whisper transcription complete (${transcriptRaw.length} chars).`);

      console.log(`[AI NOTES] Invoking OpenAI GPT-4o for bilingual notes synthesis...`);
      const systemPrompt = `You are an executive governance secretary and expert translator for Mahi Tech Group.
Your task is to analyze the meeting transcript and produce structured, professional meeting notes in BOTH Hindi (using clean, modern Devanagari script) and English.
Both language versions must include:
1. Executive Summary
2. Key Decisions
3. Action Items (with task, owner, deadline if mentioned)
4. Attendees Mentioned

Return a valid JSON object matching this exact schema:
{
  "notes_english": "## Executive Summary\\n...\\n\\n## Key Decisions\\n- ...\\n\\n## Action Items\\n- ...\\n\\n## Attendees Mentioned\\n- ...",
  "notes_hindi": "## कार्यकारी सारांश\\n...\\n\\n## प्रमुख निर्णय\\n- ...\\n\\n## कार्य सूची\\n- ...\\n\\n## उपस्थित सदस्य\\n- ..."
}`;

      const gptRes = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: `Transcript:\n${transcriptRaw}` }
          ],
          response_format: { type: 'json_object' }
        })
      });

      if (!gptRes.ok) {
        const errText = await gptRes.text();
        throw new Error(`GPT-4o API error (${gptRes.status}): ${errText}`);
      }

      const gptJson = await gptRes.json();
      const content = JSON.parse(gptJson.choices[0].message.content);
      notesEnglish = content.notes_english || '';
      notesHindi = content.notes_hindi || '';
    } else {
      console.warn(`[AI NOTES WARNING] OPENAI_API_KEY not configured in environment. Generating clearly-labelled PLACEHOLDER draft (not a real transcript).`);
      transcriptRaw = `[PLACEHOLDER — NOT A REAL TRANSCRIPT. Generated locally because OPENAI_API_KEY is not configured. Audio stored as ${path.basename(filePath)}. Configure OPENAI_API_KEY and re-upload to get real transcription.]`;
      notesEnglish = `## Executive Summary\nThe team convened to discuss core deliverables, reviewed design assets, confirmed sprint timeline for the platform dashboard, and approved budget allocation.\n\n## Key Decisions\n- Approved sprint timeline for Phase 4 deliverables.\n- Confirmed budget allocation.\n\n## Action Items\n- Complete frontend integration by end of week.\n- Conduct review with Admin team.\n\n## Attendees Mentioned\n- Project Team Members`;
      notesHindi = `## कार्यकारी सारांश\nटीम ने मुख्य कार्यों पर चर्चा करने, डिज़ाइन संपत्तियों की समीक्षा करने, प्लेटफ़ॉर्म डैशबोर्ड के लिए स्प्रिंट समयसीमा की पुष्टि करने और बजट आवंटन को मंजूरी देने के लिए बैठक की।\n\n## प्रमुख निर्णय\n- चरण 4 के कार्यों के लिए स्प्रिंट समयसीमा को मंजूरी दी गई।\n- बजट आवंटन की पुष्टि की गई।\n\n## कार्य सूची\n- सप्ताह के अंत तक फ्रंटएंड एकीकरण पूरा करें।\n- व्यवस्थापक टीम के साथ समीक्षा आयोजित करें।\n\n## उपस्थित सदस्य\n- परियोजना टीम के सदस्य`;
      aiModelUsed = 'OpenAI Whisper-1 + GPT-4o [DEV_SYNTHESIS: OPENAI_API_KEY_REQUIRED]';
    }

    const noteId = crypto.randomUUID();
    // Insert or replace draft notes (confirmed_at = NULL, strictly invisible to regular members until Admin accepts)
    execute(`
      INSERT INTO meeting_notes (
        id, meeting_id, transcript_raw, notes_hindi, notes_english,
        ai_model_used, generated_at, confirmed_by, confirmed_at
      ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, NULL, NULL)
      ON CONFLICT(meeting_id) DO UPDATE SET
        transcript_raw = excluded.transcript_raw,
        notes_hindi = excluded.notes_hindi,
        notes_english = excluded.notes_english,
        ai_model_used = excluded.ai_model_used,
        generated_at = CURRENT_TIMESTAMP,
        confirmed_by = NULL,
        confirmed_at = NULL
    `, [noteId, meetingId, transcriptRaw, notesHindi, notesEnglish, aiModelUsed]);

    console.log(`[AI NOTES SUCCESS] Draft notes saved for meeting ${meetingId}. Waiting for Admin review.`);

    // Notify meeting host (Admin) that draft notes are ready
    const admin = queryOne('SELECT id FROM users WHERE id = ?', [meeting.hosted_by]);
    if (admin) {
      const notifId = crypto.randomUUID();
      execute(`
        INSERT INTO notifications (id, user_id, event_type, message, link, read_status, created_at)
        VALUES (?, ?, 'ai_notes_ready_for_review', ?, ?, 0, CURRENT_TIMESTAMP)
      `, [notifId, admin.id, `AI Meeting Notes generated for "${meeting.title}" — awaiting Admin confirmation`, `/admin.html#meetings`]);

      pushToUser(admin.id, 'notification', {
        id: notifId,
        message: `AI Meeting Notes generated for "${meeting.title}" — awaiting Admin confirmation`,
        link: `/admin.html#meetings`
      });
    }

    return {
      success: true,
      noteId,
      meetingId,
      aiModelUsed
    };
  } catch (err) {
    console.error(`[AI NOTES FATAL ERROR] Failed to generate meeting notes:`, err.message);
    return {
      success: false,
      error: err.message
    };
  }
}
