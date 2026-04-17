// Remove caracteres de controle (\x00-\x1F exceto \n \t), trim, colapsa espaços excessivos
export function sanitizeInput(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .trim()
    .replace(/[ \t]{4,}/g, '   ');
}

// Escapa tags XML para evitar que o usuário feche os delimitadores do prompt
export function escapeXmlTags(str) {
  return str.replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function sanitizeField(str) {
  return escapeXmlTags(sanitizeInput(str));
}
