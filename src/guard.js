export function containsWriteCommands(text = '') {
  return /(^|\n)\/\S+\/(add|set|remove|enable|disable|reset|reboot)\b/i.test(text) || /\b(system reboot|reset-configuration)\b/i.test(text);
}

export const ADVISORY_FOOTER =
  '\n\n---\nCatatan: Output ini bersifat KONSULTATIF. AI MikroTik Assistant beroperasi read-only dan tidak pernah mengeksekusi atau mengubah konfigurasi router. Jika ada command RouterOS di atas, tinjau dampak, dependensi, dan risiko terlebih dahulu, lalu jalankan manual di router.';

const FOOTER_ANCHOR = '\n\n---\nCatatan: Output ini bersifat KONSULTATIF.';

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