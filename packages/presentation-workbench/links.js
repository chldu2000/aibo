/** Classify explicit Markdown destinations; never turn arbitrary prose into file links. */
export function linkTarget(href) {
  if (!href || /[\u0000-\u001f\u007f]/.test(href)) return null;
  if (/^https?:\/\//i.test(href)) return /\s/.test(href) ? null : {kind:'web'};
  if (/^mailto:/i.test(href)) return /\s/.test(href) ? null : {kind:'email'};
  if (/^(?:#|\/\/|\\\\)/.test(href)) return null;
  let path = href, line = null, column = null;
  const location = /#L([1-9]\d*)(?:-L?([1-9]\d*))?$/.exec(path) ?? /:([1-9]\d*)(?::([1-9]\d*))?$/.exec(path);
  if (location) {
    line = Number(location[1]);
    column = location[0][0] === ':' && location[2] ? Number(location[2]) : null;
    if (!Number.isSafeInteger(line) || line > 2147483647 || (column !== null && (!Number.isSafeInteger(column) || column > 2147483647))) return null;
    path = path.slice(0, location.index);
  }
  if (/^[a-z][a-z\d+.-]*:/i.test(href) && !/^file:\/\//i.test(href) && !/^[a-z]:[/\\]/i.test(href) && !(location && path.includes('.'))) return null;
  if (/^[a-z][a-z\d+.-]*:/i.test(path) && !/^file:\/\//i.test(path) && !/^[a-z]:[/\\]/i.test(path)) return null;
  try {
    if (/^file:\/\//i.test(path)) {
      const url = new URL(path);
      if (url.hostname && url.hostname !== 'localhost' || url.search || url.hash) return null;
      path = decodeURIComponent(url.pathname);
      if (/^\/[a-z]:\//i.test(path)) path = path.slice(1);
    } else path = decodeURIComponent(path);
  } catch { return null; }
  if (!path || /[\u0000-\u001f\u007f]/.test(path) || /^(?:\/\/|\\\\)/.test(path)) return null;
  return {kind:'file',path,line,column};
}

export const linkIcons = {web:'globe',email:'mail',file:'file'};
export const linkLabels = {web:'网页',email:'邮件',file:'本地文件'};
export const linkIconPaths = {
  web:'M21 12a9 9 0 1 1-18 0 9 9 0 1 1 18 0M3 12h18M12 3c-5 5-5 13 0 18 5-5 5-13 0-18Z',
  email:'M3 5h18v14H3ZM3 5l9 7 9-7',
  file:'M5 3h9l5 5v13H5ZM14 3v6h5',
};
