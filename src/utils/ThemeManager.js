/**
 * ThemeManager.js — SwingDJ 컬러 테마 관리 및 헤더 테마 선택 UI
 */

export const THEMES = [
  {
    id: 'gold',
    name: '클래식 골드',
    desc: '딥 다크 & 브라스 골드 (기본)',
    swatch: '#f0c060',
    bgSwatch: '#0c0c18',
    spectrum: ['#f0c060', '#ff8040', '#ff4060'],
  },
  {
    id: 'neon',
    name: '사이버 네온',
    desc: '일렉트릭 시안 & 블루 클럽',
    swatch: '#22d3ee',
    bgSwatch: '#07111e',
    spectrum: ['#22d3ee', '#38bdf8', '#a855f7'],
  },
  {
    id: 'rose',
    name: '벨벳 로즈',
    desc: '사보이 볼룸 버건디 & 로즈 골드',
    swatch: '#fb7185',
    bgSwatch: '#160b12',
    spectrum: ['#fb7185', '#f43f5e', '#fbbf24'],
  },
  {
    id: 'emerald',
    name: '재즈 에메랄드',
    desc: '스모키 포레스트 & 민트 라운지',
    swatch: '#34d399',
    bgSwatch: '#071512',
    spectrum: ['#34d399', '#10b981', '#facc15'],
  },
  {
    id: 'violet',
    name: '미드나잇 퍼플',
    desc: '벨벳 바이올렛 & 라벤더 네온',
    swatch: '#c084fc',
    bgSwatch: '#110b1d',
    spectrum: ['#c084fc', '#818cf8', '#f472b6'],
  },
  {
    id: 'light',
    name: '데이타임 라이트',
    desc: '야외 행사 · 주간 밝은 화면용',
    swatch: '#d97706',
    bgSwatch: '#f6f3ec',
    spectrum: ['#d97706', '#ea580c', '#dc2626'],
  },
];

export class ThemeManager {
  constructor(onThemeChange = null) {
    this.currentTheme  = 'gold';
    this.onThemeChange = onThemeChange; // (themeId, themeObj) => void
    this._btn          = null;
    this._popover      = null;
    this._open         = false;
  }

  mount(headerEl, initialTheme = 'gold') {
    this.applyTheme(initialTheme, false);

    // 헤더 테마 버튼 (프로파일 버튼 앞에 배치)
    const btn = document.createElement('button');
    btn.id        = 'theme-btn';
    btn.type      = 'button';
    btn.className = 'theme-header-btn';
    btn.title     = '컬러 테마 변경';
    btn.innerHTML = `<span class="theme-btn-dot" id="theme-btn-dot"></span><span>테마</span>`;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggle();
    });
    headerEl.appendChild(btn);
    this._btn = btn;

    // 테마 선택 팝오버
    const pop = document.createElement('div');
    pop.id        = 'theme-popover';
    pop.className = 'theme-popover';
    pop.style.display = 'none';
    pop.innerHTML = `
      <div class="theme-pop-header">
        <span class="theme-pop-title">🎨 컬러 테마 선택</span>
        <button type="button" class="bpm-pop-close" id="theme-pop-close" title="닫기 (Esc)">✕</button>
      </div>
      <div class="theme-grid" id="theme-grid">
        ${THEMES.map((t) => `
          <button type="button" class="theme-card" data-theme-id="${t.id}" title="${t.desc}">
            <span class="theme-swatch" style="background:${t.bgSwatch};border-color:${t.swatch}">
              <span class="theme-swatch-core" style="background:${t.swatch}"></span>
            </span>
            <span class="theme-card-text">
              <span class="theme-card-name">${t.name}</span>
              <span class="theme-card-desc">${t.desc}</span>
            </span>
          </button>
        `).join('')}
      </div>
    `;
    document.body.appendChild(pop);
    this._popover = pop;

    pop.querySelector('#theme-pop-close').addEventListener('click', () => this.close());
    pop.querySelectorAll('.theme-card').forEach((card) => {
      card.addEventListener('click', () => {
        const id = card.dataset.themeId;
        this.applyTheme(id, true);
        this.close();
      });
    });

    document.addEventListener('mousedown', (e) => {
      if (this._open && !this._popover.contains(e.target) && !this._btn.contains(e.target)) {
        this.close();
      }
    });

    document.addEventListener('keydown', (e) => {
      if (this._open && e.key === 'Escape') {
        e.preventDefault();
        this.close();
      }
    });

    this._syncUI();
  }

  applyTheme(themeId, notify = true) {
    const found = THEMES.find((t) => t.id === themeId) || THEMES[0];
    this.currentTheme = found.id;
    document.documentElement.setAttribute('data-theme', found.id);
    this._syncUI();
    if (notify && this.onThemeChange) {
      this.onThemeChange(found.id, found);
    }
    return found;
  }

  getThemeObject() {
    return THEMES.find((t) => t.id === this.currentTheme) || THEMES[0];
  }

  getSpectrumColors() {
    return this.getThemeObject().spectrum;
  }

  toggle() {
    this._open ? this.close() : this.open();
  }

  open() {
    if (!this._popover || !this._btn) return;
    this._open = true;
    this._popover.style.display = 'flex';
    this._syncUI();

    const rect = this._btn.getBoundingClientRect();
    const popW = 280;
    let left = rect.right - popW;
    let top  = rect.bottom + 8;
    if (left < 8) left = 8;
    if (left + popW > window.innerWidth - 8) left = window.innerWidth - popW - 8;
    this._popover.style.left = `${Math.round(left)}px`;
    this._popover.style.top  = `${Math.round(top)}px`;
  }

  close() {
    this._open = false;
    if (this._popover) this._popover.style.display = 'none';
  }

  _syncUI() {
    const cur = this.getThemeObject();
    const dot = this._btn?.querySelector('#theme-btn-dot');
    if (dot) dot.style.background = cur.swatch;
    this._popover?.querySelectorAll('.theme-card').forEach((card) => {
      card.classList.toggle('active', card.dataset.themeId === cur.id);
    });
  }
}
