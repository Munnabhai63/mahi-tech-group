/**
 * PRD 16 — Layer 4: Reusable Tool Links Panel Component
 * Inline per-point tool link management ("Connect your own tool" UX)
 * 
 * HARD RULES:
 * - NEVER auto-execute anything. Recommended tools are display suggestions only.
 * - Role is verified from server user object.
 * - Deleted tools do not reappear (soft delete).
 */

(function (global) {
  'use strict';

  // Quick suggestion tools (display-only, click to pre-fill URL field)
  const RECOMMENDED_TOOLS = [
    { name: 'Notion', icon: '📝', base: 'https://notion.so/' },
    { name: 'GitHub', icon: '🐙', base: 'https://github.com/' },
    { name: 'Figma', icon: '🎨', base: 'https://figma.com/' },
    { name: 'Jira', icon: '📋', base: 'https://atlassian.net/' },
    { name: 'Trello', icon: '📌', base: 'https://trello.com/' }
  ];

  function escapeHTML(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  async function apiRequest(endpoint, method = 'GET', body = null) {
    const token = localStorage.getItem('token') || '';
    const headers = {
      'Content-Type': 'application/json'
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const options = { method, headers };
    if (body && method !== 'GET') {
      options.body = JSON.stringify(body);
    }

    const res = await fetch(endpoint, options);
    let data = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    return { status: res.status, ok: res.ok, data };
  }

  /**
   * ToolLinksPanel object exposed globally
   */
  const ToolLinksPanel = {
    /**
     * Toggles the inline tool links panel inside a point card container
     */
    async toggle(pointId, containerEl, currentUser, onCountChange) {
      if (!containerEl) return;

      const existingPanel = containerEl.querySelector(`.tool-links-panel[data-point-id="${pointId}"]`);
      if (existingPanel) {
        existingPanel.remove();
        return;
      }

      // Create panel element
      const panel = document.createElement('div');
      panel.className = 'tool-links-panel';
      panel.dataset.pointId = pointId;
      panel.innerHTML = `<div class="tool-links-loading" style="padding: 12px; color: #94a3b8; font-size: 13px;">Loading attached tools...</div>`;
      containerEl.appendChild(panel);

      await this.render(pointId, panel, currentUser, onCountChange);
    },

    /**
     * Renders panel contents
     */
    async render(pointId, panelEl, currentUser, onCountChange) {
      const res = await apiRequest(`/api/pointpool/points/${pointId}/tools`);
      if (!res.ok) {
        panelEl.innerHTML = `<div class="tool-links-error" style="padding: 10px; color: #f87171; font-size: 12px;">Failed to load tools: ${escapeHTML(res.data?.error || 'Unknown error')}</div>`;
        return;
      }

      const tools = Array.isArray(res.data) ? res.data : [];
      if (typeof onCountChange === 'function') {
        onCountChange(tools.length);
      }

      const isAdminOrLead = currentUser?.role === 'admin' || currentUser?.role === 'lead' || currentUser?.sub_role === 'lead';

      let linksHtml = '';
      if (tools.length === 0) {
        linksHtml = `<div class="tool-empty" style="color: #64748b; font-size: 12px; font-style: italic; margin-bottom: 10px;">No tools attached to this point yet.</div>`;
      } else {
        linksHtml = `<div class="tool-list" style="display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px;">
          ${tools.map(tool => {
            const canDelete = isAdminOrLead || (currentUser && tool.added_by === currentUser.id);
            return `
              <div class="tool-item" style="display: flex; align-items: center; justify-content: space-between; background: #0f172a; border: 1px solid #334155; border-radius: 6px; padding: 6px 10px; font-size: 13px;">
                <div style="display: flex; align-items: center; gap: 8px; min-width: 0; overflow: hidden;">
                  <span style="font-size: 14px;">🔗</span>
                  <a href="${escapeHTML(tool.tool_url)}" target="_blank" rel="noopener noreferrer" style="color: #60a5fa; text-decoration: none; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${escapeHTML(tool.tool_url)}">
                    ${escapeHTML(tool.tool_name || 'Tool link')} ↗
                  </a>
                </div>
                ${canDelete ? `
                  <button class="btn-delete-tool" data-tool-id="${tool.id}" style="background: transparent; border: none; color: #f87171; cursor: pointer; padding: 2px 6px; border-radius: 4px; font-size: 12px;" title="Remove tool link">✕</button>
                ` : ''}
              </div>
            `;
          }).join('')}
        </div>`;
      }

      const suggestionsHtml = `
        <div class="tool-suggestions" style="margin-bottom: 10px;">
          <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: #94a3b8; margin-bottom: 6px;">Suggested Tools (click to pre-fill)</div>
          <div style="display: flex; flex-wrap: wrap; gap: 6px;">
            ${RECOMMENDED_TOOLS.map(t => `
              <button type="button" class="tool-suggest-btn" data-name="${t.name}" data-base="${t.base}" style="display: inline-flex; align-items: center; gap: 4px; background: #1e293b; border: 1px solid #334155; color: #cbd5e1; border-radius: 4px; padding: 3px 8px; font-size: 11px; cursor: pointer; transition: all 0.15s;">
                <span>${t.icon}</span> <span>${t.name}</span>
              </button>
            `).join('')}
          </div>
        </div>
      `;

      const formHtml = `
        <form class="tool-add-form" style="display: flex; flex-direction: column; gap: 8px; background: #0b1120; border: 1px dashed #334155; border-radius: 6px; padding: 10px;">
          <div style="font-size: 12px; font-weight: 600; color: #e2e8f0;">＋ Connect Your Own Tool</div>
          <div style="display: flex; gap: 6px;">
            <input type="text" class="tool-input-name" placeholder="Tool Name (e.g. Figma)" required style="flex: 1; background: #1e293b; border: 1px solid #334155; border-radius: 4px; padding: 6px 8px; color: #f8fafc; font-size: 12px;">
            <input type="url" class="tool-input-url" placeholder="https://..." required style="flex: 2; background: #1e293b; border: 1px solid #334155; border-radius: 4px; padding: 6px 8px; color: #f8fafc; font-size: 12px;">
          </div>
          <div class="tool-form-error" style="color: #f87171; font-size: 11px; display: none;"></div>
          <div style="display: flex; justify-content: flex-end;">
            <button type="submit" class="btn-save-tool" style="background: #3b82f6; border: none; border-radius: 4px; color: #ffffff; padding: 5px 12px; font-size: 12px; font-weight: 600; cursor: pointer;">Connect Link</button>
          </div>
        </form>
      `;

      panelEl.innerHTML = `
        <div style="margin-top: 10px; padding: 12px; background: #020617; border: 1px solid #1e293b; border-radius: 8px;">
          ${linksHtml}
          ${suggestionsHtml}
          ${formHtml}
        </div>
      `;

      // Wire suggestion buttons
      panelEl.querySelectorAll('.tool-suggest-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const nameInput = panelEl.querySelector('.tool-input-name');
          const urlInput = panelEl.querySelector('.tool-input-url');
          if (nameInput) nameInput.value = btn.dataset.name + ' Workspace';
          if (urlInput) {
            urlInput.value = btn.dataset.base;
            urlInput.focus();
          }
        });
      });

      // Wire delete buttons
      panelEl.querySelectorAll('.btn-delete-tool').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.preventDefault();
          const toolId = btn.dataset.toolId;
          btn.disabled = true;
          btn.textContent = '...';

          const delRes = await apiRequest(`/api/pointpool/points/${pointId}/tools/${toolId}`, 'DELETE');
          if (delRes.ok) {
            await ToolLinksPanel.render(pointId, panelEl, currentUser, onCountChange);
          } else {
            alert('Failed to delete tool: ' + (delRes.data?.error || 'Unauthorized'));
            btn.disabled = false;
            btn.textContent = '✕';
          }
        });
      });

      // Wire submit form
      const form = panelEl.querySelector('.tool-add-form');
      const errBox = panelEl.querySelector('.tool-form-error');
      if (form) {
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          if (errBox) errBox.style.display = 'none';

          const nameInput = form.querySelector('.tool-input-name');
          const urlInput = form.querySelector('.tool-input-url');
          const tool_name = (nameInput?.value || '').trim();
          const tool_url = (urlInput?.value || '').trim();

          // Client-side protocol check
          if (!tool_url.startsWith('http://') && !tool_url.startsWith('https://')) {
            if (errBox) {
              errBox.textContent = 'Tool URL must start with http:// or https://';
              errBox.style.display = 'block';
            }
            return;
          }

          const submitBtn = form.querySelector('.btn-save-tool');
          if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = 'Connecting...';
          }

          const addRes = await apiRequest(`/api/pointpool/points/${pointId}/tools`, 'POST', {
            tool_name,
            tool_url
          });

          if (addRes.ok) {
            await ToolLinksPanel.render(pointId, panelEl, currentUser, onCountChange);
          } else {
            if (errBox) {
              errBox.textContent = addRes.data?.error || 'Failed to add tool link';
              errBox.style.display = 'block';
            }
            if (submitBtn) {
              submitBtn.disabled = false;
              submitBtn.textContent = 'Connect Link';
            }
          }
        });
      }
    }
  };

  global.ToolLinksPanel = ToolLinksPanel;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = ToolLinksPanel;
  }
})(typeof window !== 'undefined' ? window : globalThis);
