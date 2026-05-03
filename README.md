# 🎷 SwingDJ

**스윙 재즈 댄스를 위한 심플 DJ 웹 플레이어**

SwingDJ는 스윙 댄스 행사나 파티에서 음악을 플레이하는 DJ들을 위해 만들어진 웹 기반의 가벼운 오디오 플레이어입니다. 복잡한 설치 없이 브라우저만으로 메인 스피커와 DJ 모니터링 헤드폰(CUE)을 분리하여 출력할 수 있으며, 직관적인 큐(Queue) 관리와 플레이리스트 기능을 제공합니다.

## ✨ 주요 기능

*   **🎧 분리 출력 (Main / CUE)**: 플로어로 나가는 메인 음악과 다음 곡을 미리 들어볼 수 있는 CUE 출력을 각각 다른 오디오 장치(오디오 인터페이스 등)로 할당할 수 있습니다.
*   **📋 직관적인 큐 & 플레이리스트**: 드래그 앤 드롭을 통해 손쉽게 파일(mp3, flac, wav 등)을 추가하고 순서를 변경할 수 있습니다.
*   **🎛️ 5밴드 이퀄라이저 (EQ) & 비트 퍼펙트**: 사운드 톤 조절은 물론, EQ가 Flat(0dB)일 때는 필터를 완전히 우회(Hard Bypass)하여 원음 그대로를 출력하는 **비트 퍼펙트(Bit-Perfect)** 기능을 지원합니다.
*   **⚡ 고성능 BPM 자동 감지**: 웹 워커(Web Worker) 기술을 사용하여 백그라운드에서 UI 끊김 없이 곡의 템포(BPM)를 정확하게 분석합니다.
*   **🛡️ 리미터(Limiter) 내장**: 출력단에 디지털 리미터를 배치하여 과도한 EQ 증폭 시에도 클리핑(소리 깨짐) 없이 깨끗한 음질을 보장합니다.
*   **💾 프로파일 저장**: 현재 세팅된 플레이리스트, 큐, 볼륨, EQ 설정 등을 로컬에 저장하고 언제든 다시 불러올 수 있습니다.
*   **📱 최적화된 모바일 UX**: 스마트폰 및 태블릿 환경을 고려한 터치 타겟 최적화와 전용 탭 인터페이스를 제공합니다.

## 🛠️ 기술 사양 (Technical Specs)

*   **Audio Engine**: Web Audio API (BiquadFilter, DynamicsCompressor, Analyser)
*   **Concurrency**: Web Workers (BPM 분석 쓰레드 분리)
*   **Storage**: IndexedDB (Profile Data), LocalStorage (Settings)
*   **Security**: HTML-Safe Metadata Rendering, File System Access API
*   **Fidelity**: 48kHz Internal Processing, Bit-Perfect Hard Bypass

## 🚀 실행 방법

SwingDJ는 순수 HTML, CSS, JavaScript(ES Modules)로 작성되어 있어 별도의 빌드 과정이 필요 없습니다. 제공된 실행 파일을 더블 클릭하기만 하면 로컬 웹 서버가 켜지고 브라우저가 자동으로 열립니다. (시스템에 Node.js나 Python이 설치되어 있어야 합니다.)

*   **Windows 사용자**: 폴더 내의 `start.bat` 파일을 더블 클릭해서 실행하세요.
*   **Mac / Linux 사용자**: 터미널을 열고 다음 명령어를 입력하세요.
    ```bash
    chmod +x start.sh  # (최초 1회만 실행 권한 부여)
    ./start.sh
    ```

*(만약 직접 수동으로 실행하고 싶다면, 터미널에서 `python -m http.server 8080` 또는 `npx http-server -p 8080` 을 입력한 후 브라우저에서 `http://localhost:8080` 으로 접속하셔도 됩니다.)*

### 💡 권장 브라우저 (중요)
모든 운영체제(Windows, Intel/Apple Silicon Mac)에서 **Google Chrome** 또는 **Microsoft Edge** 사용을 강력히 권장합니다.
* 사파리(Safari) 등 일부 브라우저에서는 **'오디오 출력 장치 분리 선택'** 기능이나 **'프로파일(파일 경로) 저장'** 기능이 브라우저 보안 정책으로 인해 제한될 수 있습니다.


## 📚 사용 방법

자세한 기능 설명 및 사용법은 [MANUAL.md](./MANUAL.md)를 참고해 주세요.
