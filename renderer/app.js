// ===== State =====
let files = [];
let preview = [];
let canUndo = false;
let editingIndex = -1;
let selectedIndices = new Set(); // indices of selected files

// ===== DOM refs =====
const $ = id => document.getElementById(id);
const fileListEl = $('fileList');
const fileCount = $('fileCount');
const fileActions = $('fileActions');
const dropZone = $('dropZone');
const dropOverlay = $('dropOverlay');
const contextMenu = $('contextMenu');

// ===== File Management =====

async function addFilesFromDialog() {
  const selected = await window.api.selectFiles();
  if (!selected || selected.length === 0) return;
  await addFiles(selected);
}

async function addFolderFromDialog() {
  const folderFiles = await window.api.selectFolder();
  if (!folderFiles || folderFiles.length === 0) return;
  await addFiles(folderFiles);
}

async function addFiles(newFiles) {
  const existing = new Set(files.map(f => f.path));
  const unique = newFiles.filter(f => !existing.has(f.path));
  if (unique.length === 0) {
    showToast('文件已在列表中', 'warning');
    return;
  }
  const details = await window.api.getFileDetails(unique);
  const startIdx = files.length;
  files.push(...details);
  // Auto-select new files
  for (let i = startIdx; i < files.length; i++) selectedIndices.add(i);
  renderFileList();
}

function removeFile(index) {
  if (editingIndex === index) cancelInlineRename();
  selectedIndices.delete(index);
  // Shift selected indices after the removed one
  const toShift = [];
  for (const idx of selectedIndices) {
    if (idx > index) toShift.push(idx);
  }
  toShift.forEach(idx => { selectedIndices.delete(idx); selectedIndices.add(idx - 1); });
  files.splice(index, 1);
  renderFileList();
}

function clearAll() {
  if (files.length === 0) return;
  cancelInlineRename();
  files = [];
  preview = [];
  selectedIndices.clear();
  renderFileList();
  hidePreview();
  showToast('已清空文件列表', 'warning');
}

// ===== Selection =====

function toggleSelectAll() {
  if (selectedIndices.size === files.length && files.length > 0) {
    // Deselect all
    selectedIndices.clear();
  } else {
    // Select all
    selectedIndices = new Set(files.map((_, i) => i));
  }
  renderFileList();
}

function toggleSelect(index) {
  if (selectedIndices.has(index)) {
    selectedIndices.delete(index);
  } else {
    selectedIndices.add(index);
  }
  renderFileList();
}

// ===== Inline Rename =====

function startInlineRename(index) {
  if (editingIndex >= 0) cancelInlineRename();
  editingIndex = index;
  renderFileList();

  const item = document.querySelector(`.file-item[data-index="${index}"]`);
  if (!item) return;

  const nameDiv = item.querySelector('.file-name');
  const currentName = files[index].name;

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'file-name-input';
  input.value = currentName;
  input.setAttribute('data-original', currentName);
  nameDiv.replaceWith(input);

  item.classList.add('renaming');
  input.focus();
  input.select();

  const finish = async (submit) => {
    if (!submit) { cancelInlineRename(); return; }
    const newName = input.value.trim();
    if (!newName || newName === files[index].name) { cancelInlineRename(); return; }
    await submitInlineRename(index, newName);
  };

  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') finish(true);
    if (e.key === 'Escape') finish(false);
  });

  input.addEventListener('blur', () => {
    setTimeout(() => { if (editingIndex === index) finish(true); }, 150);
  });
}

async function submitInlineRename(index, newName) {
  const f = files[index];
  const oldPath = f.path;
  const newPath = f.dir + '\\' + newName;
  const newExt = newName.includes('.') ? '.' + newName.split('.').pop() : '';

  const result = await window.api.renameSingle({ oldPath, newPath, originalName: f.name, newName });
  editingIndex = -1;

  if (result.success) {
    f.path = newPath;
    f.name = newName;
    f.ext = newExt || f.ext;
    if (result.size !== undefined) {
      Object.assign(f, {
        size: result.size, sizeFormatted: result.sizeFormatted,
        modifiedTime: result.modifiedTime, modifiedTimeFormatted: result.modifiedTimeFormatted,
        createdTime: result.createdTime, createdTimeFormatted: result.createdTimeFormatted,
      });
    }
    canUndo = true;
    $('btnUndo').disabled = false;
    renderFileList();
    showToast(`已重命名为: ${newName}`, 'success');
  } else {
    renderFileList();
    showToast(`重命名失败: ${result.error}`, 'error');
  }
}

function cancelInlineRename() {
  editingIndex = -1;
  renderFileList();
}

// ===== Context Menu =====

let contextMenuIndex = -1;

function showContextMenu(e, index) {
  e.preventDefault();
  e.stopPropagation();
  hideContextMenu();
  contextMenuIndex = index;
  contextMenu.style.left = e.clientX + 'px';
  contextMenu.style.top = e.clientY + 'px';
  contextMenu.classList.add('active');
}

function hideContextMenu() {
  contextMenu.classList.remove('active');
  contextMenuIndex = -1;
}

$('ctxRename').addEventListener('click', () => {
  if (contextMenuIndex >= 0) startInlineRename(contextMenuIndex);
  hideContextMenu();
});

$('ctxRemove').addEventListener('click', () => {
  if (contextMenuIndex >= 0) removeFile(contextMenuIndex);
  hideContextMenu();
});

document.addEventListener('click', (e) => {
  if (!contextMenu.contains(e.target)) hideContextMenu();
});

// ===== Sorting =====

function sortFiles() {
  cancelInlineRename();
  const by = $('sortBy').value;
  const order = $('sortOrder').value;
  const dir = order === 'asc' ? 1 : -1;

  // Build index mapping before sort
  const indexed = files.map((f, i) => ({ file: f, origIdx: i }));
  indexed.sort((a, b) => {
    const fa = a.file, fb = b.file;
    let cmp = 0;
    switch (by) {
      case 'name': cmp = fa.name.localeCompare(fb.name, 'zh-CN', { numeric: true }); break;
      case 'modifiedTime': cmp = (fa.modifiedTime || '').localeCompare(fb.modifiedTime || ''); break;
      case 'createdTime': cmp = (fa.createdTime || '').localeCompare(fb.createdTime || ''); break;
      case 'size': cmp = (fa.size || 0) - (fb.size || 0); break;
      case 'ext': cmp = fa.ext.localeCompare(fb.ext); break;
    }
    return cmp * dir;
  });

  // Rebuild selection based on new order
  const newSelection = new Set();
  indexed.forEach((item, newIdx) => {
    if (selectedIndices.has(item.origIdx)) newSelection.add(newIdx);
  });
  selectedIndices = newSelection;
  files = indexed.map(item => item.file);
  renderFileList();
}

// ===== Render File List =====

function renderFileList() {
  fileListEl.innerHTML = '';
  fileCount.textContent = `共 ${files.length} 个文件，已选 ${selectedIndices.size} 个`;
  fileActions.style.display = files.length > 0 ? 'block' : 'none';

  if (files.length === 0) {
    fileListEl.innerHTML = '<div class="file-list-empty">暂无文件，拖拽或点击上方按钮添加</div>';
    return;
  }

  const fragment = document.createDocumentFragment();
  files.forEach((f, i) => {
    const div = document.createElement('div');
    div.className = 'file-item' + (editingIndex === i ? ' renaming' : '');
    div.dataset.index = i;

    const icon = getFileIcon(f.ext);
    const shortName = f.name.length > 40 ? f.name.substring(0, 37) + '...' : f.name;
    const checked = selectedIndices.has(i) ? 'checked' : '';

    div.innerHTML = `
      <input type="checkbox" class="file-checkbox" ${checked}>
      <span class="file-icon">${icon}</span>
      <div class="file-info">
        <div class="file-name" title="${escapeHtml(f.name)}">${escapeHtml(shortName)}</div>
        <div class="file-meta">${f.sizeFormatted}${f.modifiedTimeFormatted ? ' · ' + f.modifiedTimeFormatted : ''}</div>
      </div>
      <button class="btn-remove" data-index="${i}" title="移除">×</button>
    `;

    // Checkbox click
    div.querySelector('.file-checkbox').addEventListener('change', (e) => {
      e.stopPropagation();
      toggleSelect(i);
    });

    // Double-click for inline rename
    div.addEventListener('dblclick', (e) => {
      if (e.target.closest('.btn-remove') || e.target.closest('.file-checkbox')) return;
      startInlineRename(i);
    });

    // Right-click for context menu
    div.addEventListener('contextmenu', (e) => {
      if (e.target.closest('.btn-remove')) return;
      showContextMenu(e, i);
    });

    fragment.appendChild(div);
  });

  fileListEl.appendChild(fragment);

  // Remove buttons
  fileListEl.querySelectorAll('.btn-remove').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      removeFile(parseInt(btn.dataset.index));
    });
  });
}

// ===== Drag & Drop =====

dropZone.addEventListener('click', addFilesFromDialog);

let dragCounter = 0;

// DOM overlay events
document.addEventListener('dragenter', (e) => {
  e.preventDefault();
  dragCounter++;
  if (dragCounter === 1) dropOverlay.classList.add('active');
});

document.addEventListener('dragleave', (e) => {
  e.preventDefault();
  dragCounter--;
  if (dragCounter === 0) dropOverlay.classList.remove('active');
});

document.addEventListener('dragover', (e) => e.preventDefault());

// Handle drop: try webUtils API, then File.path, then IPC fallback
async function handleDropFiles(files) {
  if (!files || files.length === 0) return;
  const fileList = [];

  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    let filePath = '';

    // Try webUtils.getPathForFile via preload API
    try {
      const p = window.api.getFilePath(f);
      if (p) filePath = p;
    } catch {}

    // Fallback: deprecated File.path
    if (!filePath) {
      try { if (f.path) filePath = f.path; } catch {}
    }

    if (!filePath) continue;

    const name = filePath.split('\\').pop() || filePath.split('/').pop() || f.name;
    const ext = name.includes('.') ? '.' + name.split('.').pop() : '';
    const sepIdx = Math.max(filePath.lastIndexOf('\\'), filePath.lastIndexOf('/'));
    const dir = sepIdx >= 0 ? filePath.substring(0, sepIdx) : '';
    fileList.push({ path: filePath, name, ext, dir });
  }

  if (fileList.length > 0) {
    await addFiles(fileList);
  } else {
    showToast('无法读取拖入的文件路径，请使用"添加文件"按钮', 'error');
  }
}

document.addEventListener('drop', (e) => {
  e.preventDefault();
  dragCounter = 0;
  dropOverlay.classList.remove('active');
  handleDropFiles(e.dataTransfer.files);
});

// IPC file drop (fallback: receives real file paths from main process)
let dropIpcRegistered = false;

// ===== Rule Tabs =====

document.querySelectorAll('.rule-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.rule-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.rule-panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.querySelector(`.rule-panel[data-rule="${tab.dataset.rule}"]`).classList.add('active');
  });
});

// ===== Naming Engine =====

function applyRule(nameWithoutExt, ext, index) {
  const activeTab = document.querySelector('.rule-tab.active');
  if (!activeTab) return nameWithoutExt + ext;
  const rule = activeTab.dataset.rule;
  switch (rule) {
    case 'sequential': return applySequential(nameWithoutExt, ext, index);
    case 'replace':    return applyReplace(nameWithoutExt, ext);
    case 'prefix':     return applyPrefix(nameWithoutExt, ext, index);
    case 'remove':     return applyRemove(nameWithoutExt, ext);
    case 'case':       return applyCase(nameWithoutExt, ext);
    case 'regex':      return applyRegex(nameWithoutExt, ext);
    case 'date':       return applyDate(nameWithoutExt, ext, index);
    case 'insert':     return applyInsert(nameWithoutExt, ext);
    case 'ext':        return applyExt(nameWithoutExt, ext);
    default:           return nameWithoutExt + ext;
  }
}

function applySequential(name, ext, index) {
  const pattern = $('seqPattern').value || '文件_{n}';
  const start = parseInt($('seqStart').value) || 1;
  const padding = parseInt($('seqPadding').value) || 3;
  const step = parseInt($('seqStep').value) || 1;
  const num = String(start + index * step).padStart(padding, '0');
  return pattern.replace(/\{n\}/g, num) + ext;
}

function applyReplace(name, ext) {
  const find = $('repFind').value;
  const replace = $('repWith').value;
  const caseSensitive = $('repCaseSensitive').checked;
  const fullName = name + ext;
  if (!find) return fullName;
  if (caseSensitive) return fullName.split(find).join(replace);
  return fullName.replace(new RegExp(escapeRegex(find), 'gi'), replace);
}

function applyPrefix(name, ext, index) {
  const text = $('preText').value || '';
  const position = document.querySelector('input[name="prePosition"]:checked');
  if (!position) return name + ext;
  let processed = text;
  if (text.includes('{n}')) {
    const start = parseInt($('seqStart').value) || 1;
    const padding = parseInt($('seqPadding').value) || 3;
    const step = parseInt($('seqStep').value) || 1;
    processed = text.replace(/\{n\}/g, String(start + index * step).padStart(padding, '0'));
  }
  return position.value === 'prefix' ? processed + name + ext : name + processed + ext;
}

function applyRemove(name, ext) {
  const text = $('remText').value;
  const position = $('remPosition').value;
  const fullName = name + ext;
  if (!text) return fullName;
  switch (position) {
    case 'all':   return fullName.split(text).join('');
    case 'start': return fullName.startsWith(text) ? fullName.slice(text.length) : fullName;
    case 'end':
      if (fullName.endsWith(text)) return fullName.slice(0, -text.length);
      if (name.endsWith(text)) return name.slice(0, -text.length) + ext;
      return fullName;
    default: return fullName;
  }
}

function applyCase(name, ext) {
  const type = $('caseType').value;
  const scope = $('caseScope').value;
  const t = (s) => {
    if (type === 'lower') return s.toLowerCase();
    if (type === 'upper') return s.toUpperCase();
    if (type === 'title') return s.replace(/\b\w/g, c => c.toUpperCase());
    return s;
  };
  if (scope === 'name') return t(name) + ext;
  if (scope === 'full') return t(name + ext);
  if (scope === 'ext')  return name + t(ext);
  return name + ext;
}

function applyRegex(name, ext) {
  const pattern = $('regexPattern').value;
  const replacement = $('regexReplace').value || '';
  const fullName = name + ext;
  if (!pattern) return fullName;
  try { return fullName.replace(new RegExp(pattern, 'g'), replacement); } catch { return fullName; }
}

function applyDate(name, ext, index) {
  const format = $('dateFormat').value || 'YYYY-MM-DD';
  const source = $('dateSource').value;
  const pattern = $('datePattern').value || '{date}';
  let date;
  if (source === 'modified' && files[index]?.modifiedTime) date = new Date(files[index].modifiedTime);
  else if (source === 'created' && files[index]?.createdTime) date = new Date(files[index].createdTime);
  else date = new Date();
  return pattern.replace(/\{date\}/g, formatDateStr(date, format)) + ext;
}

function applyInsert(name, ext) {
  const text = $('insText').value || '';
  let pos = parseInt($('insPosition').value) || 0;
  const fullName = name + ext;
  if (pos < 0) pos = Math.max(0, fullName.length + pos);
  return fullName.slice(0, pos) + text + fullName.slice(pos);
}

function applyExt(name, ext) {
  const newExt = $('extNew').value || '';
  return name + (newExt ? '.' + newExt : '');
}

// ===== Helpers =====

function formatDateStr(date, format) {
  const pad = (n) => String(n).padStart(2, '0');
  const map = {
    YYYY: String(date.getFullYear()), YY: String(date.getFullYear()).slice(2),
    MM: pad(date.getMonth() + 1), DD: pad(date.getDate()),
    HH: pad(date.getHours()), mm: pad(date.getMinutes()), ss: pad(date.getSeconds()),
  };
  let r = format;
  for (const [k, v] of Object.entries(map)) r = r.replace(k, v);
  return r;
}

function escapeRegex(str) { return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function getFileIcon(ext) {
  const icons = {
    '.pdf': '📄', '.doc': '📝', '.docx': '📝',
    '.xls': '📊', '.xlsx': '📊',
    '.jpg': '🖼', '.jpeg': '🖼', '.png': '🖼', '.gif': '🖼', '.webp': '🖼', '.svg': '🖼', '.bmp': '🖼',
    '.mp4': '🎬', '.avi': '🎬', '.mkv': '🎬', '.mov': '🎬',
    '.mp3': '🎵', '.wav': '🎵', '.flac': '🎵',
    '.zip': '📦', '.rar': '📦', '.7z': '📦', '.tar': '📦', '.gz': '📦',
    '.txt': '📃', '.md': '📃',
    '.exe': '⚙', '.dll': '⚙',
    '.html': '🌐', '.css': '🎨', '.js': '⚡', '.ts': '⚡', '.json': '📋',
  };
  return icons[ext.toLowerCase()] || '📄';
}

function escapeHtml(str) { const d = document.createElement('div'); d.textContent = str; return d.innerHTML; }

// ===== Preview =====

function generatePreview() {
  if (files.length === 0) { showToast('请先添加文件', 'warning'); return; }
  if (selectedIndices.size === 0) { showToast('请先选择要重命名的文件', 'warning'); return; }
  cancelInlineRename();

  // Build a local index for selected files (sequential within selection)
  const selectedArray = [...selectedIndices].sort((a, b) => a - b);

  preview = files.map((f, i) => {
    // If file is not selected, mark as skip
    if (!selectedIndices.has(i)) {
      return {
        originalName: f.name, newName: f.name,
        dir: f.dir, path: f.path, newPath: f.path,
        status: 'skip', error: '未选中',
      };
    }

    const selIdx = selectedArray.indexOf(i);
    const nameWithoutExt = f.name.slice(0, f.name.length - f.ext.length);
    const newName = applyRule(nameWithoutExt, f.ext, selIdx);

    return {
      originalName: f.name, newName,
      dir: f.dir, path: f.path, newPath: f.dir + '\\' + newName,
      status: 'ok', error: null,
    };
  });

  // Detect conflicts
  const nameCount = new Map();
  preview.forEach(p => { if (selectedIndices.has(files.findIndex(f => f.path === p.path))) nameCount.set(p.newName, (nameCount.get(p.newName) || 0) + 1); });

  preview = preview.map(p => {
    if (p.status === 'skip') return p;
    if (nameCount.get(p.newName) > 1) return { ...p, status: 'conflict', error: '与另一个文件重名' };
    if (p.newName === p.originalName) return { ...p, status: 'skip', error: '文件名无变化' };
    return p;
  });

  renderPreview();
  showPreview();
}

function renderPreview() {
  const body = $('previewBody');
  const count = $('previewCount');
  body.innerHTML = '';

  const ok = preview.filter(p => p.status === 'ok').length;
  const conflict = preview.filter(p => p.status === 'conflict').length;
  const skip = preview.filter(p => p.status === 'skip').length;
  count.textContent = `${preview.length} 个文件（${ok} 正常 · ${conflict} 冲突 · ${skip} 跳过）`;

  preview.forEach((p, i) => {
    const tr = document.createElement('tr');
    if (p.status === 'skip' && p.error === '未选中') tr.style.opacity = '0.4';
    const cls = p.status === 'ok' ? 'badge-ok' : p.status === 'conflict' ? 'badge-conflict' : 'badge-skip';
    const txt = p.status === 'ok' ? '就绪' : p.status === 'conflict' ? '冲突' : '未处理';

    tr.innerHTML = `
      <td>${i + 1}</td>
      <td title="${escapeHtml(p.originalName)}">${escapeHtml(p.originalName)}</td>
      <td>→</td>
      <td title="${escapeHtml(p.newName)}">${escapeHtml(p.newName)}</td>
      <td><span class="badge ${cls}">${txt}</span></td>
    `;
    body.appendChild(tr);
  });
}

function showPreview() { $('previewSection').style.display = 'flex'; }
function hidePreview() { $('previewSection').style.display = 'none'; }

// ===== Execute Rename =====

async function executeRename() {
  if (preview.length === 0) { showToast('请先预览重命名结果', 'warning'); return; }

  const toRename = preview.filter(p => p.status === 'ok');
  if (toRename.length === 0) { showToast('没有需要重命名的文件', 'warning'); return; }

  const conflictCount = preview.filter(p => p.status === 'conflict').length;
  if (conflictCount > 0) { showToast(`存在 ${conflictCount} 个命名冲突，请修改规则后重试`, 'error'); return; }

  const renameList = toRename.map(p => ({
    oldPath: p.path, newPath: p.newPath,
    originalName: p.originalName, newName: p.newName, dir: p.dir,
  }));

  const results = await window.api.renameFiles(renameList);
  let successCount = 0, failCount = 0;
  const failDetails = [];
  results.forEach(r => { if (r.success) successCount++; else { failCount++; failDetails.push(r.originalName + ': ' + r.error); } });

  // Update file list with new names after rename
  const updatedFiles = [];
  for (const f of files) {
    const result = results.find(r => r.oldPath === f.path);
    if (result && result.success) {
      updatedFiles.push({
        ...f,
        path: result.newPath,
        name: result.newName,
        ext: result.newName.lastIndexOf('.') >= 0 ? result.newName.slice(result.newName.lastIndexOf('.')) : '',
      });
    } else {
      updatedFiles.push(f);
    }
  }
  files = await window.api.getFileDetails(updatedFiles);

  // Preserve selections (map old paths to new)
  const oldNewMap = {};
  results.forEach(r => { if (r.success) oldNewMap[r.oldPath] = r.newPath; });
  const newSelection = new Set();
  files.forEach((f, i) => {
    const oldIdx = [...files.keys()].find(idx => files[idx] === f);
    // Keep selected if was successful or was skipped
    if (oldNewMap[f.path] || selectedIndices.has(i)) {
      // Simplified: reselect all files after rename
      newSelection.add(i);
    }
  });
  // Actually just select all files after rename
  selectedIndices = new Set(files.map((_, i) => i));

  renderFileList();
  preview = []; // clear preview to avoid stale state
  hidePreview();

  if (failCount === 0) {
    showToast(`成功重命名 ${successCount} 个文件`, 'success');
    canUndo = true;
    $('btnUndo').disabled = false;
  } else {
    showToast(`成功 ${successCount} 个，失败 ${failCount} 个\n${failDetails.join('\n')}`, 'error');
  }
}

// ===== Undo =====

async function undoRename() {
  const results = await window.api.undoRename();
  if (results.length === 0) { showToast('没有可撤销的操作', 'warning'); return; }

  const successCount = results.filter(r => r.success).length;
  const failCount = results.filter(r => !r.success).length;

  // Update file list
  for (const r of results) {
    if (r.success) {
      const f = files.find(f => f.path === r.newPath);
      if (f) {
        f.path = r.oldPath;
        f.name = r.originalName;
        f.ext = '.' + r.originalName.split('.').pop();
      }
    }
  }
  files = await window.api.getFileDetails(files);
  renderFileList();
  hidePreview();

  if (failCount === 0) {
    showToast(`已成功撤销 ${successCount} 个文件的改名`, 'success');
    canUndo = false;
    $('btnUndo').disabled = true;
  } else {
    showToast(`撤销完成：成功 ${successCount}，失败 ${failCount}`, 'error');
  }
}

// ===== Export Mapping =====

async function exportMapping() {
  if (preview.length === 0) { showToast('请先预览重命名结果', 'warning'); return; }
  const result = await window.api.exportMapping(preview);
  if (result.success) showToast(`映射表已导出到：${result.path}`, 'success');
  else if (result.error) showToast(`导出失败：${result.error}`, 'error');
}

// ===== Toast =====

function showToast(message, type = 'info') {
  const toast = $('toast');
  toast.textContent = message;
  toast.className = 'toast ' + type;
  toast.classList.add('show');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove('show'), 3000);
}

// ===== Event Bindings =====

document.addEventListener('DOMContentLoaded', () => {
  $('btnAddFiles').addEventListener('click', addFilesFromDialog);
  $('btnAddFolder').addEventListener('click', addFolderFromDialog);
  $('btnClear').addEventListener('click', clearAll);
  $('btnSort').addEventListener('click', sortFiles);
  $('btnPreview').addEventListener('click', generatePreview);
  $('btnExecute').addEventListener('click', executeRename);
  $('btnUndo').addEventListener('click', undoRename);
  $('btnExport').addEventListener('click', exportMapping);
  $('btnCancelPreview').addEventListener('click', hidePreview);

  // Select All / Deselect All button (added to panel-header)
  // Inject if not already there
  const panelHeader = document.querySelector('.panel-left .panel-header .btn-group');
  if (panelHeader && !document.getElementById('btnToggleSelect')) {
    const selBtn = document.createElement('button');
    selBtn.id = 'btnToggleSelect';
    selBtn.className = 'btn btn-sm btn-outline';
    selBtn.textContent = '☑ 全选';
    selBtn.addEventListener('click', () => {
      toggleSelectAll();
      selBtn.textContent = selectedIndices.size === files.length && files.length > 0 ? '☐ 取消全选' : '☑ 全选';
    });
    panelHeader.appendChild(selBtn);
  }

  // Welcome modal (first launch)
  (function showWelcome() {
    if (localStorage.getItem('welcomeShown')) return;
    const overlay = document.getElementById('welcomeOverlay');
    if (overlay) overlay.style.display = 'flex';
  })();

  document.getElementById('welcomeStartBtn')?.addEventListener('click', () => {
    const overlay = document.getElementById('welcomeOverlay');
    if (document.getElementById('welcomeNoShow')?.checked) {
      localStorage.setItem('welcomeShown', 'true');
    }
    if (overlay) overlay.style.display = 'none';
  });

  // Help button — reopen welcome modal
  document.getElementById('btnHelp')?.addEventListener('click', () => {
    const overlay = document.getElementById('welcomeOverlay');
    if (overlay) overlay.style.display = 'flex';
  });

  // IPC file drop (main process fallback)
  window.api.onFilesDropped(async (filePaths) => {
    if (!filePaths || filePaths.length === 0) return;
    const fileList = filePaths.map(fp => {
      const name = fp.split('\\').pop() || fp.split('/').pop() || '';
      const ext = name.includes('.') ? '.' + name.split('.').pop() : '';
      const sepIdx = Math.max(fp.lastIndexOf('\\'), fp.lastIndexOf('/'));
      const dir = sepIdx >= 0 ? fp.substring(0, sepIdx) : '';
      return { path: fp, name, ext, dir };
    });
    await addFiles(fileList);
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'Enter') { e.preventDefault(); generatePreview(); }
    if (e.ctrlKey && e.key === 'r') { e.preventDefault(); executeRename(); }
    if (e.ctrlKey && e.key === 'z') { e.preventDefault(); undoRename(); }
    if (e.key === 'Escape') { hideContextMenu(); cancelInlineRename(); }
  });
});
