// Browser-only: prepares an invoice photo/PDF for upload.

const MAX_EDGE = 2400
const JPEG_QUALITY = 0.85

/**
 * Phone photos are often 5–12 MB. Re-encode images to a JPEG of at most
 * 2400px on the longest edge: smaller uploads, and a format the AI can read
 * (HEIC photos decode in Safari and come out as JPEG). PDFs pass unchanged.
 */
export async function prepareInvoiceFile(file: File): Promise<File> {
  if (!file.type.startsWith('image/') && !/\.(heic|heif)$/i.test(file.name)) return file
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
    const width = Math.round(bitmap.width * scale)
    const height = Math.round(bitmap.height * scale)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, width, height)
    ctx.drawImage(bitmap, 0, 0, width, height)
    bitmap.close?.()
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY))
    if (!blob) return file
    const base = file.name.replace(/\.[^.]+$/, '') || 'fatura'
    return new File([blob], `${base}.jpg`, { type: 'image/jpeg', lastModified: Date.now() })
  } catch {
    return file
  }
}

export function invoiceMime(file: File): string {
  if (file.type) return file.type
  if (/\.pdf$/i.test(file.name)) return 'application/pdf'
  if (/\.(heic|heif)$/i.test(file.name)) return 'image/heic'
  return 'application/octet-stream'
}
