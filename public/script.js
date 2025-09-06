// ===== Helper =====
const $ = sel => document.querySelector(sel);
let currentChannel = null;
let uploadedImage = null;
let selectedMessageText = null;

// escape HTML
function escapeHtml(s) {
  if (!s) return '';
  return s.replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');
}

// beautify text
function beautifyText(s) {
  if (!s) return '';
  return s.replace(/\r\n/g, '\n')
          .replace(/\.{3}/g, '…')
          .replace(/--/g, '—')
          .replace(/\t/g, '    ')
          .trim();
}

// ===== Markdown + Code =====
function formatMarkdown(text) {
  if (!text) return '';
  let html = escapeHtml(text);
  html = html.replace(/^## (.*)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.*)$/gm, '<h1>$1</h1>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/\n{2,}/g, '</p><p>');
  html = html.replace(/\n/g, '<br/>');
  return `<p>${html}</p>`;
}

function renderMessageHtml(text) {
  let t = text || '';
  const codeBlockRegex = /```([\s\S]*?)```/g;
  let out = '';
  let lastIndex = 0;
  let m;
  while ((m = codeBlockRegex.exec(t)) !== null) {
    out += formatMarkdown(t.slice(lastIndex, m.index));
    out += `<pre class="code-block">${escapeHtml(m[1].replace(/^\n+|\n+$/g,''))}</pre>`;
    lastIndex = codeBlockRegex.lastIndex;
  }
  out += formatMarkdown(t.slice(lastIndex));
  return out;
}

// ===== Channels =====
async function loadChannels() {
  const r = await fetch('/api/channels');
  const data = await r.json();
  const list = $('#channelsList');
  list.innerHTML = '';
  data.channels.forEach(c => {
    const li = document.createElement('li');
    li.textContent = c.name;
    li.dataset.id = c._id;
    li.addEventListener('click', () => {
      document.querySelectorAll('#channelsList li').forEach(x => x.classList.remove('active'));
      li.classList.add('active');
      currentChannel = c;
      $('#channelTitle').textContent = c.name;
      loadMessages(c._id);
    });
    list.appendChild(li);
  });
  if (!currentChannel && data.channels.length) list.firstChild.click();
}

$('#newChannelBtn').addEventListener('click', async () => {
  const name = prompt('Channel name','New Channel');
  if (!name) return;
  await fetch('/api/channels', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ name }) });
  await loadChannels();
});

$('#renameBtn').addEventListener('click', async () => {
  if (!currentChannel) return alert('Pick a channel first');
  const name = prompt('New channel name', currentChannel.name);
  if (!name) return;
  await fetch(`/api/channels/${currentChannel._id}`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ op:'rename', name }) });
  await loadChannels();
});

$('#deleteChannelBtn').addEventListener('click', async () => {
  if (!currentChannel) return alert('Pick a channel first');
  if (!confirm('Delete this channel and all messages?')) return;
  await fetch(`/api/channels/${currentChannel._id}`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ op:'delete' }) });
  currentChannel = null;
  $('#channelTitle').textContent = 'Choose a channel';
  $('#messages').innerHTML = '';
  await loadChannels();
});

// ===== Messages =====
async function loadMessages(channelId) {
  $('#messages').innerHTML = '';
  const r = await fetch(`/api/messages?channelId=${channelId}`);
  const data = await r.json();
  if (!data.ok) return;
  data.messages.forEach(renderMessage);
  $('#messages').scrollTop = $('#messages').scrollHeight;
}

function renderMessage(m) {
  const tpl = document.getElementById('messageTemplate');
  const node = tpl.content.cloneNode(true);
  const el = node.querySelector('.message');
  el.dataset.id = m._id;
  el.classList.add(m.role === 'assistant' ? 'assistant' : (m.role === 'user' ? 'user' : 'system'));
  node.querySelector('.role').textContent = (m.role === 'user' ? 'You' : (m.role === 'assistant' ? 'Assistant' : 'System'));
  node.querySelector('.time').textContent = new Date(m.createdAt).toLocaleString();
  const content = node.querySelector('.content');

  // image support
  if (m.imageId) {
    const img = document.createElement('img');
    img.src = `/api/images/${m.imageId}`;
    img.style.maxWidth = '320px';
    img.style.display = 'block';
    img.style.marginBottom = '8px';
    content.appendChild(img);
  }

  const beaut = beautifyText(m.text || '');
  content.innerHTML += renderMessageHtml(beaut);

  // highlight code blocks
  if (window.hljs) {
    content.querySelectorAll('.code-block').forEach(block => hljs.highlightElement(block));
  }

  // copy button
  const copyBtn = node.querySelector('.copyBtn');
  copyBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const plain = (m.text || '') + (m.imageId ? `\n[image: ${m.imageId}]` : '');
    await navigator.clipboard.writeText(plain);
    copyBtn.textContent = 'Copied!';
    setTimeout(() => copyBtn.textContent = 'Copy', 1200);
  });

  // click to prefill composer
  el.addEventListener('click', (ev) => {
    ev.stopPropagation();
    selectedMessageText = m.text || '';
    if (!selectedMessageText) return;
    if (confirm('Ask the chat about this message?')) {
      $('#textInput').value = `Follow up: "${selectedMessageText}"\n\n`;
      $('#textInput').focus();
    }
  });

  $('#messages').appendChild(node);
}

// ===== Upload Image =====
$('#imageInput').addEventListener('change', (ev) => {
  const file = ev.target.files[0];
  if (!file) return;
  uploadFile(file);
});

function uploadFile(file) {
  $('#imagePreview').classList.remove('hidden');
  $('#previewImg').src = URL.createObjectURL(file);
  $('#uploadProgress').textContent = 'Uploading: 0%';

  const xhr = new XMLHttpRequest();
  xhr.open('POST','/api/upload');
  xhr.upload.onprogress = (e) => {
    if (e.lengthComputable) {
      const pct = Math.round(e.loaded / e.total * 100);
      $('#uploadProgress').textContent = `Uploading: ${pct}%`;
    }
  };
  xhr.onload = () => {
    if (xhr.status === 200) {
      const res = JSON.parse(xhr.responseText);
      if (res.ok) uploadedImage = { imageId: res.imageId, filename: res.filename };
      $('#uploadProgress').textContent = res.ok ? `Uploaded: ${res.filename}` : 'Upload failed';
    } else $('#uploadProgress').textContent = 'Upload failed';
  };
  const fd = new FormData();
  fd.append('image', file);
  xhr.send(fd);
}

$('#removeImageBtn').addEventListener('click', () => {
  uploadedImage = null;
  $('#previewImg').src = '';
  $('#uploadProgress').textContent = '';
  $('#imagePreview').classList.add('hidden');
  $('#imageInput').value = '';
});

// ===== Ask Selected =====
$('#askSelectedBtn').addEventListener('click', () => {
  if (!selectedMessageText) return alert('Click a message to select it first');
  $('#textInput').value = `Follow up: "${selectedMessageText}"\n\n`;
  $('#textInput').focus();
});

// ===== Poll Assistant Until Done =====
function pollAssistantUntilDone(channelId, assistantId, onDone) {
  let tries = 0;
  const iv = setInterval(async () => {
    tries++;
    const r = await fetch(`/api/messages?channelId=${channelId}`);
    const j = await r.json();
    if (j.ok) {
      const updated = j.messages.find(m => m._id === assistantId);
      if (updated && !updated.pending) {
        clearInterval(iv);
        if (onDone) onDone();
      }
    }
    if (tries > 40) clearInterval(iv);
  }, 1500);
}

// ===== Send Message =====
$('#sendBtn').addEventListener('click', async () => {
  if (!currentChannel) return alert('Choose a channel first');
  const text = $('#textInput').value.trim();
  if (!text && !uploadedImage) return alert('Enter text or attach an image');

  $('#sendBtn').disabled = true;
  $('#sendingIndicator').classList.remove('hidden');

  const payload = { 
    channelId: currentChannel._id, 
    text, 
    imageId: uploadedImage ? uploadedImage.imageId : null 
  };

  try {
    const res = await fetch('/api/send', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
    const data = await res.json();
    if (data.ok) {
      await loadMessages(currentChannel._id);
      if (data.assistant && data.assistant.pending) {
        pollAssistantUntilDone(currentChannel._id, data.assistant._id, async ()=> await loadMessages(currentChannel._id));
      }
      // clear composer
      $('#textInput').value = '';
      uploadedImage = null;
      $('#previewImg').src = '';
      $('#uploadProgress').textContent = '';
      $('#imagePreview').classList.add('hidden');
      $('#imageInput').value = '';
    } else alert('Send failed: ' + (data.error || 'unknown'));
  } catch (err) {
    console.error(err);
    alert('Error sending message');
  } finally {
    $('#sendingIndicator').classList.add('hidden');
    $('#sendBtn').disabled = false;
  }
});

// ===== Init =====
loadChannels();
