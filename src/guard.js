export function containsWriteCommands(text = '') {
  if (!text) return false;
  if (/\b(system reboot|reset-configuration)\b/i.test(text)) return true;
  const lines = String(text).split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('/') && /\b(add|set|remove|enable|disable|reset|reboot)\b/i.test(trimmed)) {
      return true;
    }
  }
  return false;
}

export const ADVISORY_FOOTER =
  '\n\n---\nCatatan: Output ini bersifat KONSULTATIF. Jika ada command RouterOS di atas, tinjau dampak dan risikonya, lalu eksekusi via tombol approval atau jalankan manual di router.';

const FOOTER_ANCHOR = '\n\n---\nCatatan: Output ini bersifat KONSULTATIF';

export function stripAdvisoryFooter(content) {
  const idx = String(content).indexOf(FOOTER_ANCHOR);
  return idx === -1 ? String(content) : String(content).slice(0, idx);
}

export function guardOutput(content) {
  const hasWrite = containsWriteCommands(content);
  return {
    content: stripAdvisoryFooter(content) + ADVISORY_FOOTER,
    flags: JSON.stringify({
      containsWriteCommands: hasWrite,
      readOnly: true,
    }),
  };
}