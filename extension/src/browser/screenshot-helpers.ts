/**
 * Screenshot helpers (simplified from AIPex)
 */

export const MAX_PADDING = 200;

/**
 * Compress image using canvas (from AIPex)
 */
export function compressImage(
  dataUrl: string,
  quality: number = 0.6,
  maxWidth: number = 1024,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Failed to get canvas context'));
        return;
      }

      let width = img.width;
      let height = img.height;

      if (width > maxWidth) {
        height = (height * maxWidth) / width;
        width = maxWidth;
      }

      canvas.width = width;
      canvas.height = height;
      ctx.drawImage(img, 0, 0, width, height);

      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = dataUrl;
  });
}

/**
 * Crop image to a specific region using canvas (from AIPex)
 */
export function cropImage(
  dataUrl: string,
  region: { x: number; y: number; width: number; height: number },
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Failed to get canvas context'));
        return;
      }

      canvas.width = region.width;
      canvas.height = region.height;

      ctx.drawImage(
        img,
        region.x, region.y, region.width, region.height,
        0, 0, region.width, region.height,
      );

      resolve(canvas.toDataURL('image/png', 0.9));
    };
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = dataUrl;
  });
}
