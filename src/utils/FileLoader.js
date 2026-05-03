/**
 * FileLoader.js — 로컬 파일 로드 + ID3 메타데이터 추출 (jsmediatags)
 */
import { formatDuration } from './TimeFormatter.js';

let _tagReaderReady = typeof jsmediatags !== 'undefined';

function readTags(file) {
  return new Promise((resolve) => {
    if (!_tagReaderReady || typeof jsmediatags === 'undefined') {
      resolve({});
      return;
    }
    jsmediatags.read(file, {
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
  } catch (e) {
    return null;
  }
}

let _trackIdCounter = 0;

export async function loadFiles(fileList) {
  const tracks = [];
  for (const file of fileList) {
    if (!file.type.startsWith('audio/') && !isAudioExtension(file.name)) continue;
    const track = await loadSingleFile(file);
    if (track) tracks.push(track);
  }
  return tracks;
}

export async function loadSingleFile(file) {
  try {
    const tags = await readTags(file);
    const albumArt = extractAlbumArt(tags);

    // 파일 이름에서 기본 정보 추출
    const nameWithoutExt = file.name.replace(/\.[^.]+$/, '');
    const [artistGuess, titleGuess] = parseFilename(nameWithoutExt);

    return {
      id: ++_trackIdCounter,
      file,
      fileHandle: file._handle || null,   // FileSystemFileHandle (프로파일 저장용)
      name: tags.title || titleGuess || nameWithoutExt,
      artist: tags.artist || artistGuess || 'Unknown Artist',
      album: tags.album || '',
      albumArt,
      duration: null,
      durationLabel: '--:--',
      bpm: null,
      mainBuffer: null,
      cueBuffer: null,
      size: file.size,
      type: file.type || 'audio/mpeg',
    };
  } catch (e) {
    console.error('loadSingleFile error:', e);
    return null;
  }
}

function parseFilename(name) {
  // "Artist - Title" 패턴 파싱
  const match = name.match(/^(.+?)\s*-\s*(.+)$/);
  if (match) return [match[1].trim(), match[2].trim()];
  return [null, name];
}

function isAudioExtension(name) {
  return /\.(mp3|flac|wav|ogg|aac|m4a|opus|weba)$/i.test(name);
}
