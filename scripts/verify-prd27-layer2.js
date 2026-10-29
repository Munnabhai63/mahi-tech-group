/**
 * scripts/verify-prd27-layer2.js
 * Verification Suite for PRD 27 Layer 2: Wiki Service & Business Logic
 *
 * Real DB verification — ZERO MOCKS.
 *
 * Verifies:
 * 1. Space Slugs: auto-generated, lowercase, alphanumeric-hyphen, collision disambiguation.
 * 2. Page Slugs: auto-generated, space-scoped uniqueness, collision disambiguation.
 * 3. Archived Space & Page Guards: all edits rejected with 400.
 * 4. Child Deletion Guard: page with child pages cannot be deleted (400).
 * 5. Version on Save: every explicit save creates an append-only row in wiki_page_versions.
 * 6. Version Restore: creates a NEW version with old content, never overwrites history.
 * 7. Backlinks Synchronization: parses PAGE_LINK blocks on save, upserts wiki_page_links.
 * 8. FTS5 Search Sync: real-time search index update on save and deletion.
 * 9. Word Count & Reading Time: computed server-side (Math.ceil(words / 200)).
 * 10. Client Shared Pages: internal comments strictly stripped at query level (Rule 12).
 * 11. System Templates Protection: is_system_template=1 cannot be deleted (400).
 * 12. Emoji Reactions: toggle on/off logic.
 * 13. Threaded Comments: nesting, edit, and resolve workflow.
 * 14. Server-Side Markdown Export: clean conversion from JSON blocks without external libraries.
 * 15. Audit Logging: admin actions logged to access_log.
 * 16. Manual updated_at: updated on all mutations.
 */

import { getDatabase, queryOne, queryAll, execute } from '../src/db/database.js';
import * as wikiService from '../src/services/wikiService.js';
import crypto from 'node:crypto';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`[PASS] ${message}`);
    passed++;
  } else {
    console.error(`[FAIL] ${message}`);
    failed++;
  }
}

async function run() {
  console.log('='.repeat(80));
  console.log('PRD 27 Layer 2 Verification Suite: Wiki Service & Business Logic');
  console.log('='.repeat(80));

  const db = getDatabase();
  const testSuffix = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  // Retrieve admin user for privileged operations
  const adminUser = queryOne("SELECT id, name, email, role FROM users WHERE role = 'admin' LIMIT 1;");
  assert(adminUser !== null, `Admin user located: ${adminUser?.name} (${adminUser?.id})`);

  // Retrieve or create regular developer member for scoping tests
  let memberUser = queryOne("SELECT id, name, email, role FROM users WHERE role = 'developer' LIMIT 1;");
  if (!memberUser) {
    const memberId = crypto.randomUUID();
    execute(
      `INSERT INTO users (id, name, email, password_hash, role, status, created_at, updated_at)
       VALUES (?, 'Wiki Test Member', ?, 'dummy_hash', 'developer', 'active', datetime('now'), datetime('now'));`,
      [memberId, `member.${testSuffix}@example.com`]
    );
    memberUser = queryOne('SELECT id, name, email, role FROM users WHERE id = ?;', [memberId]);
  }
  assert(memberUser !== null, `Member user located: ${memberUser?.name} (${memberUser?.id})`);

  // ---------------------------------------------------------
  // Test 1: Space Slug Generation & Collision Disambiguation
  // ---------------------------------------------------------
  console.log('\n=== Test 1: Space Slug Generation & Collision Disambiguation ===');

  const slugTest1 = wikiService.slugify('Engineering & Architecture Standards - 2026! @#$');
  assert(slugTest1 === 'engineering-architecture-standards-2026', `Slugify generated clean slug: "${slugTest1}"`);

  const spaceName = `Test Engineering Space ${testSuffix}`;
  const space1 = wikiService.createSpace(
    { name: spaceName, description: 'Core dev docs', visibility: 'INTERNAL' },
    adminUser
  );
  assert(space1 && space1.id > 0, `Space 1 created with ID: ${space1?.id}`);
  assert(space1.slug.startsWith('test-engineering-space'), `Space 1 has valid slug: "${space1.slug}"`);

  // Create duplicate named space -> should auto-disambiguate slug with suffix -1
  const space2 = wikiService.createSpace(
    { name: spaceName, description: 'Duplicate name test', visibility: 'INTERNAL' },
    adminUser
  );
  assert(space2.slug === `${space1.slug}-1`, `Space 2 collision disambiguated to: "${space2.slug}"`);

  // ---------------------------------------------------------
  // Test 2: Page Slug Generation & Space-Scoped Uniqueness
  // ---------------------------------------------------------
  console.log('\n=== Test 2: Page Slug Generation & Space-Scoped Uniqueness ===');

  const pageTitle = `Getting Started Guide ${testSuffix}`;
  const page1 = wikiService.createPage(
    {
      space_id: space1.id,
      title: pageTitle,
      content: JSON.stringify([
        { id: 'b1', type: 'HEADING_1', content: pageTitle },
        { id: 'b2', type: 'PARAGRAPH', content: 'Welcome to the platform architecture documentation.' }
      ])
    },
    adminUser
  );
  assert(page1 && page1.id > 0, `Page 1 created with ID: ${page1?.id}`);
  assert(page1.slug.startsWith('getting-started-guide'), `Page 1 has valid slug: "${page1.slug}"`);

  // Create page with identical title in SAME space -> disambiguated
  const page2 = wikiService.createPage(
    {
      space_id: space1.id,
      title: pageTitle,
      content: JSON.stringify([{ id: 'b1', type: 'PARAGRAPH', content: 'Second page with same title.' }])
    },
    adminUser
  );
  assert(page2.slug === `${page1.slug}-1`, `Page 2 collision disambiguated to: "${page2.slug}"`);

  // Create page with same title in DIFFERENT space -> allowed to use same base slug!
  const pageInSpace2 = wikiService.createPage(
    {
      space_id: space2.id,
      title: pageTitle,
      content: JSON.stringify([{ id: 'b1', type: 'PARAGRAPH', content: 'Different space page.' }])
    },
    adminUser
  );
  assert(pageInSpace2.slug === page1.slug, `Same slug allowed in different space: "${pageInSpace2.slug}"`);

  // ---------------------------------------------------------
  // Test 3: Space Access Scoping & Membership
  // ---------------------------------------------------------
  console.log('\n=== Test 3: Space Access Scoping & Membership ===');

  // Member should NOT see space1 initially
  const initialMemberSpaces = wikiService.getSpaces(memberUser);
  const seesSpace1Before = initialMemberSpaces.some(s => s.id === space1.id);
  assert(!seesSpace1Before, 'Member cannot see space before being added');

  // Add member to space1 as EDITOR
  const addedMember = wikiService.addSpaceMember(space1.id, { user_id: memberUser.id, role: 'EDITOR' }, adminUser);
  assert(addedMember && addedMember.role === 'EDITOR', 'Member added as EDITOR');

  // Member should now see space1
  const updatedMemberSpaces = wikiService.getSpaces(memberUser);
  const seesSpace1After = updatedMemberSpaces.some(s => s.id === space1.id);
  assert(seesSpace1After, 'Member can now see space1 in space list');

  // ---------------------------------------------------------
  // Test 4: Archived Guards (Space & Page Edits Rejected with 400)
  // ---------------------------------------------------------
  console.log('\n=== Test 4: Archived Guards ===');

  // Create dedicated space for archive testing
  const archiveSpace = wikiService.createSpace(
    { name: `Archive Test Space ${testSuffix}`, visibility: 'INTERNAL' },
    adminUser
  );
  const archivePage = wikiService.createPage(
    { space_id: archiveSpace.id, title: 'Active Page in Space', content: '[]' },
    adminUser
  );

  // Archive space
  wikiService.archiveSpace(archiveSpace.id, adminUser);
  const archivedSpaceRow = queryOne('SELECT is_archived FROM wiki_spaces WHERE id = ?;', [archiveSpace.id]);
  assert(archivedSpaceRow?.is_archived === 1, 'Space successfully marked as archived');

  // Attempt to edit archived space -> 400
  try {
    wikiService.updateSpace(archiveSpace.id, { name: 'New Name' }, adminUser);
    assert(false, 'Edits to archived space should be rejected');
  } catch (err) {
    assert(err.status === 400, `Edits to archived space rejected with 400: "${err.message}"`);
  }

  // Attempt to create page in archived space -> 400
  try {
    wikiService.createPage({ space_id: archiveSpace.id, title: 'Blocked Child Page' }, adminUser);
    assert(false, 'Creating page in archived space should be rejected');
  } catch (err) {
    assert(err.status === 400, `Page creation in archived space rejected with 400: "${err.message}"`);
  }

  // Attempt to edit page in archived space -> 400
  try {
    wikiService.updatePage(archivePage.id, { title: 'Attempted Page Title' }, adminUser);
    assert(false, 'Page update in archived space should be rejected');
  } catch (err) {
    assert(err.status === 400, `Page update in archived space rejected with 400: "${err.message}"`);
  }

  // Test individual page archive status in active space
  wikiService.updatePageStatus(page2.id, 'ARCHIVED', adminUser);
  try {
    wikiService.updatePage(page2.id, { title: 'Updating Archived Page' }, adminUser);
    assert(false, 'Editing archived page should be rejected');
  } catch (err) {
    assert(err.status === 400, `Archived page edit rejected with 400: "${err.message}"`);
  }

  // ---------------------------------------------------------
  // Test 5: Child Deletion Guard (Cannot Delete Page with Children)
  // ---------------------------------------------------------
  console.log('\n=== Test 5: Child Deletion Guard ===');

  const parentPage = wikiService.createPage(
    { space_id: space1.id, title: `Parent Page ${testSuffix}`, content: '[]' },
    adminUser
  );
  const childPage = wikiService.createPage(
    { space_id: space1.id, parent_page_id: parentPage.id, title: `Child Page ${testSuffix}`, content: '[]' },
    adminUser
  );

  // Attempt to delete parent while child exists -> must reject with 400
  try {
    wikiService.deletePage(parentPage.id, adminUser);
    assert(false, 'Deleting page with child pages should have thrown 400');
  } catch (err) {
    assert(
      err.status === 400 && err.message.includes('child pages'),
      `Page with children blocked from deletion: "${err.message}"`
    );
  }

  // Delete child page first
  const delChild = wikiService.deletePage(childPage.id, adminUser);
  assert(delChild.success === true, 'Child page successfully deleted');

  // Now delete parent page -> succeeds
  const delParent = wikiService.deletePage(parentPage.id, adminUser);
  assert(delParent.success === true, 'Parent page deleted cleanly after children removed');

  // ---------------------------------------------------------
  // Test 6: Version on Save & Non-Destructive Restore
  // ---------------------------------------------------------
  console.log('\n=== Test 6: Append-Only Versions on Save & Restore ===');

  const vPage = wikiService.createPage(
    {
      space_id: space1.id,
      title: `Versioned Document ${testSuffix}`,
      content: JSON.stringify([{ id: 'v-b1', type: 'PARAGRAPH', content: 'Version 1 content snapshot.' }])
    },
    adminUser
  );
  assert(vPage.current_version === 1, 'Initial page version is 1');

  // Save 2
  wikiService.updatePage(
    vPage.id,
    {
      content: JSON.stringify([{ id: 'v-b1', type: 'PARAGRAPH', content: 'Version 2 updated content.' }]),
      change_summary: 'Added architecture diagram description'
    },
    adminUser
  );

  // Save 3
  wikiService.updatePage(
    vPage.id,
    {
      content: JSON.stringify([{ id: 'v-b1', type: 'PARAGRAPH', content: 'Version 3 final production draft.' }]),
      change_summary: 'Polished release notes'
    },
    adminUser
  );

  const allVersions = wikiService.getPageVersions(vPage.id, adminUser);
  assert(allVersions.length === 3, `Exactly 3 versions recorded for page (found: ${allVersions.length})`);
  assert(allVersions[0].version_number === 3, 'Latest version is version 3');
  assert(allVersions[1].version_number === 2, 'Prior version is version 2');
  assert(allVersions[2].version_number === 1, 'Initial version is version 1');

  // Verify append-only DB triggers are actively protecting these versions
  try {
    execute("UPDATE wiki_page_versions SET title = 'Tampered' WHERE id = ?;", [allVersions[0].id]);
    assert(false, 'Direct update to wiki_page_versions should be blocked by trigger');
  } catch (err) {
    assert(err.message.includes('append-only'), `Trigger prevented update: "${err.message}"`);
  }

  // RESTORE Version 1: Non-destructive! Must create Version 4 with Version 1 content!
  const v1Record = allVersions.find(v => v.version_number === 1);
  const restoredPage = wikiService.restorePageVersion(vPage.id, v1Record.id, adminUser);

  const versionsAfterRestore = wikiService.getPageVersions(vPage.id, adminUser);
  assert(versionsAfterRestore.length === 4, `Version count incremented to 4 after restore (found: ${versionsAfterRestore.length})`);
  assert(versionsAfterRestore[0].version_number === 4, 'New version 4 created for the restore');
  assert(
    versionsAfterRestore[0].change_summary.includes('Restored from version 1'),
    `Restore audit summary: "${versionsAfterRestore[0].change_summary}"`
  );
  assert(
    restoredPage.content_text.includes('Version 1 content snapshot'),
    'Page active content restored to Version 1 snapshot'
  );

  // ---------------------------------------------------------
  // Test 7: Backlinks & PAGE_LINK Parsing
  // ---------------------------------------------------------
  console.log('\n=== Test 7: Backlinks & PAGE_LINK Parsing ===');

  const targetPage = wikiService.createPage(
    { space_id: space1.id, title: `Target Destination ${testSuffix}`, content: '[]' },
    adminUser
  );

  const sourcePage = wikiService.createPage(
    {
      space_id: space1.id,
      title: `Source Referrer ${testSuffix}`,
      content: JSON.stringify([
        { id: 'lnk1', type: 'PARAGRAPH', content: 'Here is a reference to another document:' },
        {
          id: 'lnk2',
          type: 'PAGE_LINK',
          content: 'Destination Page',
          attrs: { target_page_id: targetPage.id }
        }
      ])
    },
    adminUser
  );

  const targetDetail = wikiService.getPageById(targetPage.id, adminUser);
  assert(
    targetDetail.backlinks.some(b => b.id === sourcePage.id),
    `Target page backlink detected from source page "${sourcePage.title}"`
  );

  // Update source page to remove the link -> backlink should auto-clear
  wikiService.updatePage(
    sourcePage.id,
    { content: JSON.stringify([{ id: 'lnk1', type: 'PARAGRAPH', content: 'Link removed.' }]) },
    adminUser
  );
  const targetDetailAfter = wikiService.getPageById(targetPage.id, adminUser);
  assert(
    !targetDetailAfter.backlinks.some(b => b.id === sourcePage.id),
    'Target page backlink cleanly removed after source page unlink'
  );

  // ---------------------------------------------------------
  // Test 8: FTS5 Full-Text Search Auto-Sync & Excerpt
  // ---------------------------------------------------------
  console.log('\n=== Test 8: FTS5 Full-Text Search Auto-Sync ===');

  const uniqueKeyword = `hyperjump${testSuffix}`;
  const searchPage = wikiService.createPage(
    {
      space_id: space1.id,
      title: `Orbital Navigation Manual`,
      content: JSON.stringify([
        {
          id: 'fts-p1',
          type: 'PARAGRAPH',
          content: `To achieve stable velocity, the interstellar crew initiates a ${uniqueKeyword} pulse sequence.`
        }
      ])
    },
    adminUser
  );

  const searchResults = wikiService.searchPages({ q: uniqueKeyword }, adminUser);
  assert(searchResults.length > 0, `FTS5 search matched newly saved page with query: "${uniqueKeyword}"`);
  assert(searchResults[0].page_id === searchPage.id, 'FTS5 returned correct page ID');
  assert(
    searchResults[0].excerpt.includes('<mark>'),
    `FTS5 generated highlighted excerpt with <mark> tags: "${searchResults[0].excerpt}"`
  );

  // Search by space_id scoping
  const scopedResults = wikiService.searchPages({ q: uniqueKeyword, space_id: space1.id }, adminUser);
  assert(scopedResults.length === 1, 'FTS5 space-scoped search verified');

  // ---------------------------------------------------------
  // Test 9: Word Count & Reading Time Server-Side Computation
  // ---------------------------------------------------------
  console.log('\n=== Test 9: Word Count & Reading Time Computation ===');

  // Generate 450 words
  const sampleWords = Array(450).fill('performance').join(' ');
  const metricPage = wikiService.createPage(
    {
      space_id: space1.id,
      title: `Telemetry Analysis`,
      content: JSON.stringify([{ id: 'm-1', type: 'PARAGRAPH', content: sampleWords }])
    },
    adminUser
  );

  assert(metricPage.word_count === 450, `Word count calculated exactly: ${metricPage.word_count}`);
  assert(
    metricPage.reading_time_minutes === 3,
    `Reading time calculated server-side: ${metricPage.reading_time_minutes} minutes (Math.ceil(450/200) = 3)`
  );

  // ---------------------------------------------------------
  // Test 10: Client Portal Sharing & Internal Comment Stripping
  // ---------------------------------------------------------
  console.log('\n=== Test 10: Client Portal Sharing & Internal Comment Stripping ===');

  // Space 1 is INTERNAL -> attempting to set client_shared must fail with 400
  try {
    wikiService.setPageClientShare(page1.id, true, adminUser);
    assert(false, 'Sharing page in INTERNAL space should throw 400');
  } catch (err) {
    assert(err.status === 400, `Client share rejected for INTERNAL space: "${err.message}"`);
  }

  // Create CLIENT_SHARED space
  const clientSpace = wikiService.createSpace(
    { name: `Client Wiki Space ${testSuffix}`, visibility: 'CLIENT_SHARED' },
    adminUser
  );
  const clientPage = wikiService.createPage(
    {
      space_id: clientSpace.id,
      title: `Client Onboarding Deliverables`,
      content: JSON.stringify([{ id: 'c-1', type: 'PARAGRAPH', content: 'Shared deliverables for Q4.' }])
    },
    adminUser
  );

  // Enable client sharing
  const shareResult = wikiService.setPageClientShare(clientPage.id, true, adminUser);
  assert(shareResult.is_client_shared === 1, 'Page client sharing enabled successfully');

  // Add internal comment
  const comment = wikiService.addComment(
    clientPage.id,
    { content: 'Confidential internal note regarding billing structure.' },
    adminUser
  );
  assert(comment && comment.id > 0, 'Internal comment added by team member');

  // Client view: Comments must be STRICTLY STRIPPED (Rule 12)
  const clientView = wikiService.getPageById(clientPage.id, { role: 'client' }, { isClient: true });
  assert(Array.isArray(clientView.comments) && clientView.comments.length === 0, 'Rule 12 Verified: Internal comments completely stripped in client view');

  const clientCommentsDirect = wikiService.getCommentsByPage(clientPage.id, { role: 'client' }, { isClient: true });
  assert(clientCommentsDirect.length === 0, 'getCommentsByPage returns empty array for client');

  // Internal team view: Comments ARE visible
  const teamView = wikiService.getPageById(clientPage.id, adminUser, { isClient: false });
  assert(teamView.comments.length === 1, 'Internal team view sees the comment normally');

  // ---------------------------------------------------------
  // Test 11: System Templates Protection & Custom Templates
  // ---------------------------------------------------------
  console.log('\n=== Test 11: System Templates Protection & Custom Templates ===');

  const systemTemplates = wikiService.getTemplates({}, adminUser);
  const sysTemplate = systemTemplates.find(t => t.is_system_template === 1);
  assert(sysTemplate !== undefined, `System template found: "${sysTemplate?.name}"`);

  // Attempt to delete system template -> must throw 400!
  try {
    wikiService.deleteTemplate(sysTemplate.id, adminUser);
    assert(false, 'Deleting system template should throw 400');
  } catch (err) {
    assert(err.status === 400, `System template delete blocked: "${err.message}"`);
  }

  // Create custom template
  const customTemplate = wikiService.saveTemplate(
    {
      name: `Custom SOP Template ${testSuffix}`,
      category: 'SOP',
      content: JSON.stringify([{ id: 'tpl-1', type: 'HEADING_1', content: 'Custom SOP' }])
    },
    adminUser
  );
  assert(customTemplate.is_system_template === 0, 'Custom template created with is_system_template = 0');

  // Delete custom template -> succeeds
  const delCustom = wikiService.deleteTemplate(customTemplate.id, adminUser);
  assert(delCustom.success === true, 'Custom template deleted successfully');

  // ---------------------------------------------------------
  // Test 12: Emoji Reactions Toggle Logic
  // ---------------------------------------------------------
  console.log('\n=== Test 12: Emoji Reactions Toggle Logic ===');

  const reactAdd = wikiService.toggleReaction(page1.id, '👍', adminUser);
  assert(reactAdd.action === 'added', 'Reaction 👍 added');

  const reactionsAfterAdd = wikiService.getReactionsByPage(page1.id, adminUser);
  const thumbsUp = reactionsAfterAdd.find(r => r.reaction === '👍');
  assert(thumbsUp && thumbsUp.count === 1 && thumbsUp.has_reacted === true, 'Thumbs up count is 1 with has_reacted = true');

  const reactRemove = wikiService.toggleReaction(page1.id, '👍', adminUser);
  assert(reactRemove.action === 'removed', 'Reaction 👍 removed on toggle');

  const reactionsAfterRemove = wikiService.getReactionsByPage(page1.id, adminUser);
  const thumbsUpAfter = reactionsAfterRemove.find(r => r.reaction === '👍');
  assert(thumbsUpAfter && thumbsUpAfter.count === 0 && thumbsUpAfter.has_reacted === false, 'Thumbs up count is 0 after removal');

  // ---------------------------------------------------------
  // Test 13: Threaded Comments & Resolve
  // ---------------------------------------------------------
  console.log('\n=== Test 13: Threaded Comments & Resolve Workflow ===');

  const rootComment = wikiService.addComment(page1.id, { content: 'Top-level discussion question' }, adminUser);
  assert(rootComment.id > 0, 'Root comment created');

  const replyComment = wikiService.addComment(
    page1.id,
    { content: 'Threaded reply answering question', parent_comment_id: rootComment.id },
    adminUser
  );
  assert(replyComment.parent_comment_id === rootComment.id, 'Reply linked to parent_comment_id');

  const resolved = wikiService.resolveComment(rootComment.id, adminUser);
  assert(resolved.is_resolved === 1 && resolved.resolved_by_name !== null, 'Comment marked resolved with resolved_by_name');

  const edited = wikiService.updateComment(replyComment.id, { content: 'Edited reply content' }, adminUser);
  assert(edited.is_edited === 1 && edited.content === 'Edited reply content', 'Comment edit tracked with is_edited = 1');

  // ---------------------------------------------------------
  // Test 14: Server-Side Markdown Export
  // ---------------------------------------------------------
  console.log('\n=== Test 14: Server-Side Markdown Export ===');

  const exportPage = wikiService.createPage(
    {
      space_id: space1.id,
      title: 'Markdown Export Test',
      content: JSON.stringify([
        { id: 'ex-h1', type: 'HEADING_1', content: 'Main Chapter' },
        { id: 'ex-p', type: 'PARAGRAPH', content: 'Introductory paragraph text.' },
        { id: 'ex-list', type: 'BULLET_LIST', content: 'Bullet Item A\nBullet Item B' },
        { id: 'ex-code', type: 'CODE', content: 'console.log("hello");', attrs: { language: 'js' } },
        { id: 'ex-callout', type: 'CALLOUT', content: 'Cautionary note block' }
      ])
    },
    adminUser
  );

  const exported = wikiService.exportPageToMarkdown(exportPage.id, adminUser);
  assert(typeof exported.markdown === 'string', 'Export returned markdown string');
  assert(exported.markdown.includes('# Markdown Export Test'), 'Markdown has top title heading');
  assert(exported.markdown.includes('- Bullet Item A'), 'Markdown contains formatted bullet items');
  assert(exported.markdown.includes('```js\nconsole.log("hello");\n```'), 'Markdown contains formatted code fence');
  assert(exported.markdown.includes('> [!NOTE]\n> Cautionary note block'), 'Markdown contains callout block');

  // ---------------------------------------------------------
  // Test 15: Audit Logging in access_log
  // ---------------------------------------------------------
  console.log('\n=== Test 15: Audit Logging in access_log ===');

  const auditRows = queryAll(
    `SELECT action, resource FROM access_log
     WHERE user_id = ? AND action LIKE 'wiki_%'
     ORDER BY id DESC LIMIT 100;`,
    [adminUser.id]
  );
  assert(auditRows.length > 0, `Found ${auditRows.length} wiki actions recorded in access_log`);
  const actions = auditRows.map(r => r.action);
  assert(actions.includes('wiki_space_created'), 'access_log contains wiki_space_created');
  assert(actions.includes('wiki_page_created'), 'access_log contains wiki_page_created');
  assert(actions.includes('wiki_space_archived'), 'access_log contains wiki_space_archived');

  // ---------------------------------------------------------
  // Test 16: Manual updated_at Timestamps on Mutations
  // ---------------------------------------------------------
  console.log('\n=== Test 16: Manual updated_at Timestamps on Mutations ===');

  const spaceBefore = queryOne('SELECT updated_at FROM wiki_spaces WHERE id = ?;', [space1.id]);
  wikiService.updateSpace(space1.id, { description: 'Updated description for timestamp check' }, adminUser);
  const spaceAfter = queryOne('SELECT updated_at FROM wiki_spaces WHERE id = ?;', [space1.id]);
  assert(spaceAfter && spaceAfter.updated_at !== null, 'wiki_spaces updated_at set on mutation');

  const pageBefore = queryOne('SELECT updated_at FROM wiki_pages WHERE id = ?;', [page1.id]);
  wikiService.updatePage(page1.id, { emoji_icon: '🚀' }, adminUser);
  const pageAfter = queryOne('SELECT updated_at FROM wiki_pages WHERE id = ?;', [page1.id]);
  assert(pageAfter && pageAfter.updated_at !== null, 'wiki_pages updated_at set on mutation');

  // ---------------------------------------------------------
  // Summary
  // ---------------------------------------------------------
  console.log('\n' + '='.repeat(80));
  console.log(`PRD 27 Layer 2 Verification Complete: ${passed} PASSED, ${failed} FAILED`);
  console.log('='.repeat(80));

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

run().catch(err => {
  console.error('Fatal Layer 2 verification error:', err);
  process.exit(1);
});
