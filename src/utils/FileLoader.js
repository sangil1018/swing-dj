/**
 * FileLoader.js — 로컬 파일/폴더 로드 + ID3 메타데이터 및 길이 추출
 */
import { formatDuration } from './TimeFormatter.js';
import { Storage } from './Storage.js';

function readTags(file) {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || typeof window.jsmediatags === 'undefined') {
      resolve({});
      return;
    }
    window.jsmediatags.read(file, {
      onSuccess: (tag) => resolve(tag.tags || {}),
      onError: () => resolve({}),
    });
  });
}

function extractAlbumArt(tags) {
  try {
    const pic = tags.picture;
    if (!pic) return null;
    const { data, format } = pic;
    const bytes = new Uint8Array(data);
    const blob = new Blob([bytes], { type: format });
    return URL.createObjectURL(blob);
  } catch (_) {
    return null;
  }
}

function extractTagBPM(tags) {
  const raw = tags.TBPM?.data ?? tags.TBPM ?? tags.bpm?.data ?? tags.bpm ?? null;
  if (raw == null) return null;
  const parsed = parseFloat(String(raw).trim());
  if (isFinite(parsed) && parsed >= 40 && parsed <= 350) {
    return Math.round(parsed);
  }
  return null;
}

/** 파일명에 표기된 BPM 추출 (예: "[168] Artist - Title", "Title (145bpm)", "Title - 180 BPM") */
function extractFilenameBPM(nameWithoutExt) {
  const str = String(nameWithoutExt || '');
  // 1) 명시적 bpm 단위 표기: "168bpm", "168 bpm"
  const explicitMatch = str.match(/(?:^|[\s([_-])(\d{2,3})\s*bpm(?:$|[\s)\]._-])/i);
  if (explicitMatch) {
    const v = parseInt(explicitMatch[1], 10);
    if (v >= 55 && v <= 340) return v;
  }
  // 2) 대괄호/소괄호 단독 3자리 템포 표기 (연도 19xx/20xx 제외): "[168]", "(145)"
  const bracketMatches = str.matchAll(/[[(]\s*(\d{2,3})\s*[\])]/g);
  for (const m of bracketMatches) {
    const v = parseInt(m[1], 10);
    if (v >= 65 && v <= 330) return v;
  }
  return null;
}

/** HTMLAudioElement 메타데이터만 빠르게 읽어 재생시간 추출 (PCM 전체 디코딩 불필요) */
export function probeAudioDuration(file) {
  return new Promise((resolve) => {
    if (typeof Audio === 'undefined' || !file) {
      resolve(null);
      return;
    }
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    audio.preload = 'metadata';
    let settled = false;

    const finish = (dur) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      audio.removeAttribute('src');
      audio.load();
      URL.revokeObjectURL(url);
      resolve(isFinite(dur) && dur > 0 ? dur : null);
    };

    const timer = setTimeout(() => finish(null), 2500);
    audio.onloadedmetadata = () => finish(audio.duration);
    audio.onerror = () => finish(null);
    audio.src = url;
  });
}

export function extractFormatLabel(fileOrName) {
  const name = typeof fileOrName === 'string' ? fileOrName : (fileOrName?.name || '');
  const extMatch = name.match(/\.([a-z0-9]+)$/i);
  if (extMatch) return extMatch[1].toUpperCase();
  const type = typeof fileOrName === 'object' ? (fileOrName?.type || '') : '';
  if (type.includes('/')) return type.split('/')[1].toUpperCase();
  return '';
}

let _trackIdCounter = 0;

export function getNextTrackId() {
  return ++_trackIdCounter;
}

export async function loadFiles(fileList) {
  // 라이브 FileList가 비동기 처리 도중 비워지는 것을 막기 위해 먼저 배열로 고정
  const files = Array.from(fileList || []);
  const tracks = [];
  for (const file of files) {
    if (!isAudioFile(file)) continue;
    const track = await loadSingleFile(file);
    if (track) tracks.push(track);
  }
  return tracks;
}

export async function loadSingleFile(file) {
  try {
    const [tags, probedDuration] = await Promise.all([
      readTags(file),
      probeAudioDuration(file),
    ]);
    const albumArt = extractAlbumArt(tags);
    const tagBpm   = extractTagBPM(tags);

    // 파일 이름에서 기본 정보 추출
    const nameWithoutExt = file.name.replace(/\.[^.]+$/, '');
    const [artistGuess, titleGuess] = parseFilename(nameWithoutExt);
    const filenameBpm = extractFilenameBPM(nameWithoutExt);
    const initialBpm = tagBpm || filenameBpm || null;

    const track = {
      id: ++_trackIdCounter,
      file,
      fileHandle: file._handle || null,   // FileSystemFileHandle (프로파일/세션 저장용)
      fileName: file.name,
      name: tags.title || titleGuess || nameWithoutExt,
      artist: tags.artist || artistGuess || 'Unknown Artist',
      album: tags.album || '',
      albumArt,
      duration: probedDuration,
      durationLabel: probedDuration ? formatDuration(probedDuration) : '--:--',
      bpm: initialBpm,
      _bpmChecked: Boolean(initialBpm),
      _bpmManual: false,
      format: extractFormatLabel(file),
      size: file.size,
      type: file.type || 'audio/mpeg',
    };

    // 이전에 사용자가 수정했거나 분석해 둔 영구 캐시 메타데이터(BPM 등) 즉시 복원
    Storage.applyCachedMetaToTrack(track);
    return track;
  } catch (e) {
    console.error('loadSingleFile error:', e);
    return null;
  }
}

export function parseFilename(name) {
  // 앞쪽 트랙 번호(예: "01. ", "02 - ")가 있을 때 정리 지원
  const match = name.match(/^(?:\d{1,3}[\s._-]+)?(.+?)\s+-\s+(.+)$/) || name.match(/^(.+?)\s*-\s*(.+)$/);
  if (match) {
    // 첫 그룹이 순수 숫자 트랙번호라면 제목만 사용 (예: "01 - Sing Sing Sing")
    if (/^\d{1,3}$/.test(match[1].trim())) {
      return [null, match[2].trim()];
    }
    return [match[1].trim(), match[2].trim()];
  }
  return [null, name.replace(/^\d{1,3}[\s._-]+/, '').trim() || name];
}

export function isAudioExtension(name) {
  return /\.(mp3|flac|wav|ogg|aac|m4a|opus|weba|aiff|aif|wma)$/i.test(name || '');
}

export function isAudioFile(file) {
  if (!file) return false;
  return Boolean((file.type && file.type.startsWith('audio/')) || isAudioExtension(file.name));
}

/** FileSystemDirectoryHandle 내부의 오디오 파일 핸들을 재귀 수집 (자연 정렬 유지) */
export async function collectAudioHandlesFromDirectory(dirHandle) {
  const handles = [];
  if (!dirHandle || typeof dirHandle.values !== 'function') return handles;

  const entries = [];
  try {
    for await (const entry of dirHandle.values()) {
      entries.push(entry);
    }
  } catch (e) {
    console.warn('Directory read error:', e);
    return handles;
  }

  entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

  for (const entry of entries) {
    if (entry.kind === 'file') {
      if (isAudioExtension(entry.name)) {
        handles.push(entry);
      }
    } else if (entry.kind === 'directory') {
      const sub = await collectAudioHandlesFromDirectory(entry);
      handles.push(...sub);
    }
  }
  return handles;
}

/** webkitGetAsEntry 폴백용 재귀 디렉토리 리더 */
async function collectFilesFromEntry(entry) {
  if (!entry) return [];
  if (entry.isFile) {
    return new Promise((resolve) => {
      entry.file(
        (f) => resolve(isAudioFile(f) ? [f] : []),
        () => resolve([])
      );
    });
  }
  if (entry.isDirectory) {
    const reader = entry.createReader();
    const allEntries = [];
    const readBatch = () =>
      new Promise((resolve) => {
        reader.readEntries(
          (batch) => resolve(batch || []),
          () => resolve([])
        );
      });
    let batch = await readBatch();
    while (batch.length > 0) {
      allEntries.push(...batch);
      batch = await readBatch();
    }
    allEntries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
    const results = [];
    for (const child of allEntries) {
      const sub = await collectFilesFromEntry(child);
      results.push(...sub);
    }
    return results;
  }
  return [];
}

/**
 * DataTransfer에서 파일/폴더 추출 (중요: 첫 await 전에 동기적으로 모든 item 캡처!)
 * 반환: Promise<{ handles: FileSystemFileHandle[], files: File[] }>
 */
export async function extractDroppedAudioSources(dataTransfer) {
  const handles = [];
  const files   = [];
  if (!dataTransfer) return { handles, files };

  if (dataTransfer.items?.length) {
    // 1단계: 첫 await 이전에 동기적으로 핸들 프로미스·엔트리·파일 참조를 모두 캡처
    const captured = [];
    for (const item of Array.from(dataTransfer.items)) {
      if (item.kind !== 'file') continue;
      const handlePromise = typeof item.getAsFileSystemHandle === 'function'
        ? item.getAsFileSystemHandle().catch(() => null)
        : null;
      const webkitEntry = typeof item.webkitGetAsEntry === 'function'
        ? item.webkitGetAsEntry()
        : null;
      const fallbackFile = item.getAsFile();
      captured.push({ handlePromise, webkitEntry, fallbackFile });
    }

    // 2단계: 비동기 해석 및 폴더 재귀 탐색
    for (const { handlePromise, webkitEntry, fallbackFile } of captured) {
      if (handlePromise) {
        const h = await handlePromise;
        if (h?.kind === 'file') {
          if (isAudioExtension(h.name)) handles.push(h);
          continue;
        }
        if (h?.kind === 'directory') {
          const dirHandles = await collectAudioHandlesFromDirectory(h);
          handles.push(...dirHandles);
          continue;
        }
      }
      if (webkitEntry) {
        const entryFiles = await collectFilesFromEntry(webkitEntry);
        files.push(...entryFiles);
        continue;
      }
      if (fallbackFile && isAudioFile(fallbackFile)) {
        files.push(fallbackFile);
      }
    }
  } else if (dataTransfer.files?.length) {
    for (const f of Array.from(dataTransfer.files)) {
      if (isAudioFile(f)) files.push(f);
    }
  }

  return { handles, files };
}
