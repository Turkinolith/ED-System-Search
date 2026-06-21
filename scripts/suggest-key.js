export function suggestKey(value) {
  const prefix = String(value ?? '').trim().toLowerCase().slice(0, 3);
  if (prefix.length < 3) return '';
  return [...prefix]
    .map((char) => {
      if (/^[a-z0-9]$/.test(char)) return char;
      return `_${char.codePointAt(0).toString(16)}`;
    })
    .join('');
}
