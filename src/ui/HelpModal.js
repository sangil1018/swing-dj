/**
 * HelpModal.js — 단축키 및 디제잉 빠른 가이드 모달
 */

export class HelpModal {
  constructor() {
    this._overlay = null;
    this._open    = false;
  }

  mount(headerEl) {
    const btn = document.createElement('button');
    btn.id        = 'help-btn';
    btn.type      = 'button';
    btn.className = 'help-header-btn';
    btn.textContent = '?';
    btn.title     = '단축키 및 사용 가이드 (?)';
    btn.addEventListener('click', () => this.toggle());
    headerEl.appendChild(btn);

    this._overlay = document.createElement('div');
    this._overlay.className = 'help-modal-overlay';
    this._overlay.innerHTML = `
      <div class="help-modal" role="dialog" aria-modal="true" aria-label="SwingDJ 빠른 사용 안내">
        <div class="help-modal-header">
          <span class="help-modal-title">🎷 SwingDJ 빠른 조작 가이드</span>
          <button type="button" class="profile-close-btn" id="help-close-btn" title="닫기 (Esc)">✕</button>
        </div>

        <div class="help-modal-body">
          <div class="help-grid">
            <div class="help-section">
              <h4>🖱️ 마우스 빠른 조작</h4>
              <ul>
                <li><span>파일 · 폴더 추가</span><strong>패널에 드래그 앤 드롭</strong></li>
                <li><span>헤드폰 미리듣기 (CUE)</span><strong>곡 우클릭 또는 🎧</strong></li>
                <li><span>큐 맨 아래에 예약</span><strong>플레이리스트 더블클릭 / +Q</strong></li>
                <li><span>바로 다음 곡으로 예약</span><strong>Shift+더블클릭 / +다음</strong></li>
                <li><span>즉시 메인 스피커 재생</span><strong>큐 항목 더블클릭</strong></li>
                <li><span>BPM 보정 / TAP 템포</span><strong>BPM 뱃지 클릭</strong></li>
                <li><span>EQ 단일 밴드 0dB 초기화</span><strong>슬라이더 더블클릭</strong></li>
              </ul>
            </div>

            <div class="help-section">
              <h4>⌨️ 키보드 단축키</h4>
              <ul>
                <li><span>목록 위/아래 이동</span><strong><kbd>↑</kbd> / <kbd>↓</kbd></strong></li>
                <li><span>선택 곡 미리듣기 (CUE)</span><strong><kbd>Q</kbd></strong></li>
                <li><span>메인 재생 / 일시정지</span><strong><kbd>P</kbd></strong></li>
                <li><span>부드러운 페이드 아웃</span><strong><kbd>F</kbd></strong></li>
                <li><span>[플레이리스트] 큐에 추가</span><strong><kbd>Enter</kbd> 또는 <kbd>&gt;</kbd></strong></li>
                <li><span>[플레이리스트] 다음 곡 예약</span><strong><kbd>N</kbd> / <kbd>Shift</kbd>+<kbd>Enter</kbd></strong></li>
                <li><span>[큐] 순서 위/아래 변경</span><strong><kbd>Alt</kbd>+<kbd>↑</kbd> / <kbd>↓</kbd></strong></li>
                 <li><span>선택 항목 삭제</span><strong><kbd>Delete</kbd></strong></li>
                <li><span>컴핏모드 ON / OFF</span><strong><kbd>C</kbd></strong></li>
                <li><span>메트로놈 시작 / 정지</span><strong><kbd>M</kbd></strong></li>
              </ul>
            </div>
          </div>

          <div class="help-tips">
            <strong>💡 스윙 디제잉 &amp; 음향 팁:</strong>
            플레이리스트 상단의 <strong>BPM 7단계 색상 칩(~160 ~ 300~)</strong>을 클릭하거나 검색창에 <code>160-180</code>처럼 입력하면 원하는 템포 대역의 곡만 즉시 골라낼 수 있습니다.
            EQ가 모두 <code>0dB</code>이고 Auto-Gain이 꺼진 상태에서는 필터와 컴프레서를 완전 직결 바이패스하는 <strong>Pure Direct Bit-Perfect</strong> 모드로 동작하며,
            빈티지 재즈 음원 간 음량 편차는 <strong>🔊 Auto-Gain</strong>으로, 좌우 극단 패닝된 옛 녹음의 클럽 PA 재생은 <strong>🎧 Mono</strong> 버튼으로 보정하세요.
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(this._overlay);

    this._overlay.addEventListener('click', (e) => {
      if (e.target === this._overlay) this.close();
    });
    this._overlay.querySelector('#help-close-btn').addEventListener('click', () => this.close());

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this._open) {
        e.preventDefault();
        this.close();
        return;
      }
      if (e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const tag = e.target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable) return;
        e.preventDefault();
        this.toggle();
      }
    });
  }

  toggle() { this._open ? this.close() : this.open(); }

  open() {
    this._open = true;
    this._overlay.classList.add('show');
  }

  close() {
    this._open = false;
    this._overlay.classList.remove('show');
  }
}
