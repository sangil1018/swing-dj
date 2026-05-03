/**
 * ProfileUI.js — 앱 전체 프로파일 저장/불러오기 UI
 *
 * 헤더의 "📁 프로파일" 버튼 → 슬라이드인 사이드 패널
 *  - 저장: 이름 입력 → 현재 앱 상태 전체 저장
 *  - 불러오기: 프로파일 선택 → EQ/볼륨/장치 적용 + 플레이리스트 복원
 *  - 삭제: 프로파일 카드에서 개별 삭제
 */

export class ProfileUI {
  /**
   * @param {ProfileManager} profileManager
   * @param {Function}       getAppState   () => { eqBands, mainVolume, cueVolume, mainDeviceId, cueDeviceId, tracks }
   * @param {Function}       applyProfile  (profileData) => void — EQ/볼륨/장치/플레이리스트 적용
   */
  constructor(profileManager, getAppState, applyProfile) {
    this.pm           = profileManager;
    this.getAppState  = getAppState;
    this.applyProfile = applyProfile;
    this._panel       = null;
    this._overlay     = null;
    this._open        = false;
  }

  /** 헤더 버튼 + 패널 DOM 삽입 */
  mount(headerEl) {
    // 헤더 버튼
    const btn = document.createElement('button');
    btn.id        = 'profile-btn';
    btn.className = 'profile-header-btn';
    btn.innerHTML = `<span class="profile-btn-icon">💾</span><span>프로파일</span>`;
    btn.title     = '앱 전체 설정 프로파일 저장/불러오기';
    btn.addEventListener('click', () => this.toggle());
    headerEl.appendChild(btn);

    // 오버레이
    this._overlay = document.createElement('div');
    this._overlay.className = 'profile-overlay';
    this._overlay.addEventListener('click', () => this.close());
    document.body.appendChild(this._overlay);

    // 사이드 패널
    this._panel = document.createElement('aside');
    this._panel.id        = 'profile-panel';
    this._panel.className = 'profile-panel';
    this._panel.setAttribute('aria-label', '프로파일 관리');
    this._panel.innerHTML = `
      <div class="profile-panel-header">
        <span class="profile-panel-title">💾 프로파일</span>
        <button class="profile-close-btn" id="profile-close-btn" title="닫기">✕</button>
      </div>

      <div class="profile-panel-body">

        <!-- 저장 영역 -->
        <section class="profile-save-section">
          <h3 class="profile-section-title">현재 설정 저장</h3>
          <p class="profile-section-desc">
            EQ · 볼륨 · 출력 장치 · 플레이리스트를<br/>하나의 프로파일로 저장합니다.
          </p>
          <div class="profile-save-row">
            <input
              type="text"
              id="profile-name-input"
              class="profile-name-input"
              placeholder="프로파일 이름 (예: 공연장 A)"
              maxlength="30"
            />
            <button id="profile-save-btn" class="profile-save-btn">
              저장
            </button>
          </div>
          <div id="profile-save-status" class="profile-save-status"></div>
        </section>

        <!-- 저장된 프로파일 목록 -->
        <section class="profile-list-section">
          <h3 class="profile-section-title">저장된 프로파일</h3>
          <div id="profile-list" class="profile-list">
            <div class="profile-empty">저장된 프로파일이 없습니다.</div>
          </div>
        </section>

      </div>
    `;
    document.body.appendChild(this._panel);

    // 이벤트 연결
    this._panel.querySelector('#profile-close-btn').addEventListener('click', () => this.close());
    this._panel.querySelector('#profile-save-btn').addEventListener('click', () => this._save());
    this._panel.querySelector('#profile-name-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this._save();
    });

    this._renderList();
  }

  toggle() { this._open ? this.close() : this.open(); }

  open() {
    this._open = true;
    this._panel.classList.add('open');
    this._overlay.classList.add('show');
    this._renderList();
    this._panel.querySelector('#profile-name-input').focus();
  }

  close() {
    this._open = false;
    this._panel.classList.remove('open');
    this._overlay.classList.remove('show');
  }

  // ── 저장 ──────────────────────────────────────────────
  async _save() {
    const input = this._panel.querySelector('#profile-name-input');
    const name  = input.value.trim();
    if (!name) { input.focus(); return; }

    const statusEl = this._panel.querySelector('#profile-save-status');
    const saveBtn  = this._panel.querySelector('#profile-save-btn');

    saveBtn.disabled   = true;
    saveBtn.textContent = '저장 중…';
    statusEl.textContent = '';
    statusEl.className   = 'profile-save-status';

    try {
      const state = this.getAppState();
      await this.pm.saveProfile(name, state);
      input.value = '';
      statusEl.textContent = `✓ "${name}" 저장됨`;
      statusEl.classList.add('success');
      this._renderList();
    } catch (err) {
      console.error(err);
      statusEl.textContent = `⚠ 저장 실패: ${err.message}`;
      statusEl.classList.add('error');
    } finally {
      saveBtn.disabled    = false;
      saveBtn.textContent = '저장';
      setTimeout(() => { statusEl.textContent = ''; statusEl.className = 'profile-save-status'; }, 3000);
    }
  }

  // ── 불러오기 ──────────────────────────────────────────
  async _load(profileId, cardEl) {
    const btn = cardEl.querySelector('.profile-load-btn');
    btn.disabled = true;
    btn.textContent = '불러오는 중…';

    try {
      const data = await this.pm.loadProfile(profileId);
      await this.applyProfile(data);
      this.close();
    } catch (err) {
      console.error(err);
      btn.textContent = '⚠ 실패';
      setTimeout(() => { btn.disabled = false; btn.textContent = '불러오기'; }, 2000);
    }
  }

  // ── 삭제 ──────────────────────────────────────────────
  async _delete(profileId) {
    if (!confirm('이 프로파일을 삭제할까요?')) return;
    await this.pm.deleteProfile(profileId);
    this._renderList();
  }

  // ── 목록 렌더 ─────────────────────────────────────────
  _renderList() {
    const listEl = this._panel?.querySelector('#profile-list');
    if (!listEl) return;

    const profiles = this.pm.getProfiles();
    if (profiles.length === 0) {
      listEl.innerHTML = `<div class="profile-empty">저장된 프로파일이 없습니다.</div>`;
      return;
    }

    listEl.innerHTML = '';
    // 최신 순
    [...profiles].reverse().forEach((p) => {
      const card = document.createElement('div');
      card.className = 'profile-card';
      card.innerHTML = `
        <div class="profile-card-info">
          <div class="profile-card-name">${escHtml(p.name)}</div>
          <div class="profile-card-meta">
            <span class="profile-meta-item">🎵 ${p.trackCount ?? p.playlist?.length ?? 0}곡</span>
            <span class="profile-meta-item">🎚 EQ: ${this._eqSummary(p.eqBands)}</span>
            <span class="profile-meta-item">🔊 ${Math.round((p.mainVolume ?? 0.85) * 100)}%</span>
            <span class="profile-meta-date">${this._fmtDate(p.createdAt)}</span>
          </div>
          <div class="profile-card-eq-preview">
            ${this._eqMiniBar(p.eqBands)}
          </div>
        </div>
        <div class="profile-card-actions">
          <button class="profile-load-btn">불러오기</button>
          <button class="profile-del-btn" title="삭제">✕</button>
        </div>
      `;

      card.querySelector('.profile-load-btn').addEventListener('click', () => this._load(p.id, card));
      card.querySelector('.profile-del-btn').addEventListener('click', () => this._delete(p.id));
      listEl.appendChild(card);
    });
  }

  // ── 헬퍼 ──────────────────────────────────────────────
  _eqSummary(bands) {
    if (!bands?.length) return 'Flat';
    const isFlat = bands.every(v => v === 0);
    if (isFlat) return 'Flat';
    return bands.map(v => v > 0 ? `+${v}` : `${v}`).join(' ');
  }

  _eqMiniBar(bands) {
    if (!bands?.length) return '';
    return `<div class="profile-eq-bars">` +
      bands.map(v => {
        const pct  = Math.round(((v + 12) / 24) * 100);
        const color = v > 0 ? 'var(--gold)' : v < 0 ? 'var(--accent-blue)' : 'var(--text-muted)';
        return `<div class="profile-eq-bar" style="height:${pct}%;background:${color}"></div>`;
      }).join('') +
    `</div>`;
  }

  _fmtDate(iso) {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      return `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    } catch { return ''; }
  }
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
