/**
 * Lumied Photo Manager — first-class photo handling
 * Features: capture, compress, background upload, gallery, timeline
 */

const MAX_WIDTH = 1280;
const MAX_HEIGHT = 960;
const QUALITY = 0.8;
const UPLOAD_QUEUE = [];
let isUploading = false;

/**
 * Compress image before upload
 */
export function compressImage(file, maxWidth = MAX_WIDTH, maxHeight = MAX_HEIGHT, quality = QUALITY) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let { width, height } = img;

        // Scale down if needed
        if (width > maxWidth || height > maxHeight) {
          const ratio = Math.min(maxWidth / width, maxHeight / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');

        // Auto-enhance: slight brightness/contrast for classroom photos
        ctx.filter = 'brightness(1.05) contrast(1.05)';
        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob((blob) => {
          resolve({
            blob,
            base64: canvas.toDataURL('image/jpeg', quality).split(',')[1],
            width,
            height,
            originalSize: file.size,
            compressedSize: blob.size,
            ratio: Math.round((1 - blob.size / file.size) * 100),
          });
        }, 'image/jpeg', quality);
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Open camera and capture photo
 */
export function capturePhoto() {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.capture = 'environment';
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return reject(new Error('Nenhuma foto selecionada'));
      const compressed = await compressImage(file);
      resolve(compressed);
    };
    input.click();
  });
}

/**
 * Pick multiple photos from gallery
 */
export function pickPhotos(maxCount = 10) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    input.onchange = async (e) => {
      const files = Array.from(e.target.files).slice(0, maxCount);
      const results = await Promise.all(files.map(f => compressImage(f)));
      resolve(results);
    };
    input.click();
  });
}

/**
 * Queue photo for background upload
 */
export function queueUpload(photo, metadata = {}) {
  UPLOAD_QUEUE.push({ photo, metadata, status: 'pending', retries: 0 });
  processQueue();
  return UPLOAD_QUEUE.length;
}

/**
 * Process upload queue in background
 */
async function processQueue() {
  if (isUploading || UPLOAD_QUEUE.length === 0) return;
  isUploading = true;

  while (UPLOAD_QUEUE.length > 0) {
    const item = UPLOAD_QUEUE.find(i => i.status === 'pending');
    if (!item) break;

    item.status = 'uploading';
    try {
      const apiUrl = metadata.apiUrl || 'https://brgorknbrjlfwvrrlwxj.supabase.co/functions/v1/comunicacao';
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'agenda_foto_upload',
          _prof_token: item.metadata.token,
          item_id: item.metadata.itemId,
          registro_id: item.metadata.registroId,
          base64: item.photo.base64,
          mime: 'image/jpeg',
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      item.status = 'done';
      item.result = data;

      // Notify UI
      if (item.metadata.onSuccess) item.metadata.onSuccess(data);
    } catch (err) {
      item.retries++;
      if (item.retries >= 3) {
        item.status = 'failed';
        if (item.metadata.onError) item.metadata.onError(err);
      } else {
        item.status = 'pending';
        await new Promise(r => setTimeout(r, 2000 * item.retries));
      }
    }
  }

  // Clean completed items
  const completed = UPLOAD_QUEUE.filter(i => i.status === 'done' || i.status === 'failed');
  completed.forEach(i => UPLOAD_QUEUE.splice(UPLOAD_QUEUE.indexOf(i), 1));

  isUploading = false;
}

/**
 * Get upload queue status
 */
export function getQueueStatus() {
  return {
    total: UPLOAD_QUEUE.length,
    pending: UPLOAD_QUEUE.filter(i => i.status === 'pending').length,
    uploading: UPLOAD_QUEUE.filter(i => i.status === 'uploading').length,
    failed: UPLOAD_QUEUE.filter(i => i.status === 'failed').length,
  };
}

/**
 * Create photo preview element
 */
export function createPhotoPreview(photo, options = {}) {
  const container = document.createElement('div');
  container.style.cssText = 'position:relative;display:inline-block;border-radius:10px;overflow:hidden;';

  const img = document.createElement('img');
  img.src = `data:image/jpeg;base64,${photo.base64}`;
  img.style.cssText = `width:${options.width || 120}px;height:${options.height || 120}px;object-fit:cover;display:block;`;
  img.loading = 'lazy';

  container.appendChild(img);

  // Upload progress indicator
  if (options.showProgress) {
    const progress = document.createElement('div');
    progress.style.cssText = 'position:absolute;bottom:0;left:0;right:0;height:3px;background:rgba(0,0,0,.2);';
    const bar = document.createElement('div');
    bar.style.cssText = 'height:100%;background:#4CAF50;width:0%;transition:width .3s;';
    bar.className = 'photo-progress';
    progress.appendChild(bar);
    container.appendChild(progress);
  }

  // Compression info
  if (options.showInfo) {
    const info = document.createElement('div');
    info.style.cssText = 'position:absolute;bottom:4px;right:4px;background:rgba(0,0,0,.6);color:#fff;font-size:9px;padding:2px 6px;border-radius:4px;';
    info.textContent = `-${photo.ratio}%`;
    container.appendChild(info);
  }

  return container;
}
