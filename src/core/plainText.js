const MOJIBAKE_MARKERS = /(?:Ã.|Â.|â.|ð.|�)/;

const COMMON_MOJIBAKE = {
  'â€“': '-',
  'â€”': '-',
  'âˆ’': '-',
  'â‰ˆ': 'approximately ',
  'â€¯': ' ',
  'â€œ': '"',
  'â€': '"',
  'â€˜': "'",
  'â€™': "'",
  'Â ': ' ',
  'Â·': '-',
};

const repairMojibake = (value) => {
  let text = String(value || '');
  Object.entries(COMMON_MOJIBAKE).forEach(([broken, fixed]) => {
    text = text.split(broken).join(fixed);
  });
  for (let attempt = 0; attempt < 2 && MOJIBAKE_MARKERS.test(text) && [...text].every((char) => char.charCodeAt(0) <= 255); attempt += 1) {
    try {
      const repaired = Buffer.from(text, 'latin1').toString('utf8');
      if (!repaired.includes('�') && repaired !== text) text = repaired;
      else break;
    } catch (err) {
      break;
    }
  }
  return text;
};

const stripMarkdown = (value) => value
  .replace(/```[\s\S]*?```/g, (block) => block.replace(/```[^\n]*\n?|```/g, ''))
  .replace(/^\s{0,3}#{1,6}\s+/gm, '')
  .replace(/\*\*(.*?)\*\*/g, '$1')
  .replace(/__(.*?)__/g, '$1')
  .replace(/(?<!\w)\*(.*?)\*(?!\w)/g, '$1')
  .replace(/(?<!\w)_(.*?)_(?!\w)/g, '$1')
  .replace(/^\s*[-*+]\s+/gm, '')
  .replace(/^\s*\d+[.)]\s+/gm, '')
  .replace(/\[(.*?)\]\([^)]*\)/g, '$1');

const sanitizePlainText = (value) => stripMarkdown(repairMojibake(value))
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
  .normalize('NFKC')
  .replace(/[\u00a0\u202f]/g, ' ')
  .replace(/[\u2010-\u2015]/g, '-')
  .replace(/[\u2018\u2019]/g, "'")
  .replace(/[\u201c\u201d]/g, '"')
  .replace(/\s+/g, ' ')
  .trim();

module.exports = { repairMojibake, stripMarkdown, sanitizePlainText };
