// client.js
const socket = io();

// UI refs - Join Area
const joinArea = document.getElementById('join-area');
const createRoomSection = document.getElementById('createRoomSection');
const joinRoomSection = document.getElementById('joinRoomSection');
const roomInfoSection = document.getElementById('roomInfoSection');
const roomLinkSection = document.getElementById('roomLinkSection');

const user1NameInput = document.getElementById('user1Name');
const user2NameInput = document.getElementById('user2Name');
const createRoomBtn = document.getElementById('createRoomBtn');
const switchToJoinBtn = document.getElementById('switchToJoinBtn');

const roomIdInput = document.getElementById('roomIdInput');
const checkRoomBtn = document.getElementById('checkRoomBtn');
const switchToCreateBtn = document.getElementById('switchToCreateBtn');

const joinAsUser1Btn = document.getElementById('joinAsUser1');
const joinAsUser2Btn = document.getElementById('joinAsUser2');
const backToJoinBtn = document.getElementById('backToJoinBtn');

const roomLinkInput = document.getElementById('roomLinkInput');
const copyLinkBtn = document.getElementById('copyLinkBtn');
const joinCreatedRoomBtn = document.getElementById('joinCreatedRoomBtn');

// UI refs - Chat Area
const chatArea = document.getElementById('chat-area');
const messagesEl = document.getElementById('messages');
const sendForm = document.getElementById('sendForm');
const messageInput = document.getElementById('messageInput');
const roomLabel = document.getElementById('roomLabel');
const participantsCountEl = document.getElementById('participantsCount');
const typingEl = document.getElementById('typing');
const leaveBtn = document.getElementById('leaveBtn');
const clearBtn = document.getElementById('clearBtn');
const exportBtn = document.getElementById('exportBtn');
const statusEl = document.getElementById('status');
const backBtn = document.getElementById('backBtn');
const menuBtn = document.getElementById('menuBtn');
const actionMenu = document.getElementById('actionMenu');
const attachBtn = document.getElementById('attachBtn');
const editUsernameBtn = document.getElementById('editUsernameBtn');

let localUsername = '';
let localRoom = '';
let typingTimer = null;
let isTyping = false;
let messages = [];
let currentRoomInfo = null;
let mySlot = null;

function appendMessage({ text, from, id, senderId, senderSlot, ts, status }) {
  const me = senderSlot === mySlot; // Use slot comparison instead of socket ID
  const div = document.createElement('div');
  div.className = 'msg ' + (me ? 'me' : 'other');
  div.setAttribute('data-message-id', id);
  
  let html = `<strong>${escapeHtml(from)}</strong> <span class="meta">· ${new Date(ts).toLocaleTimeString()}</span>`;
  if (me) {
    html += ` <button class="delete-btn" data-id="${id}">Delete</button>`;
  }
  html += `<div>${escapeHtml(text)}</div>`;
  
  // Add status indicator for sent messages
  if (me) {
    html += `<div class="message-status" data-status="${status || 'sent'}">
      ${getStatusIcon(status || 'sent')}
    </div>`;
  }
  
  div.innerHTML = html;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;

  // Store message
  messages.push({ text, from, id, senderId, senderSlot, ts, status: status || 'sent' });
  
  // Mark as read if it's from someone else
  if (!me) {
    markMessagesAsRead([id]);
  }
}

function getStatusIcon(status) {
  switch(status) {
    case 'sent':
      return '<span class="status-icon status-sent">✓</span>';
    case 'delivered':
      return '<span class="status-icon status-delivered">✓✓</span>';
    case 'read':
      return '<span class="status-icon status-read">✓✓</span>';
    default:
      return '';
  }
}

function updateMessageStatus(messageId, status) {
  const msgDiv = messagesEl.querySelector(`[data-message-id="${messageId}"]`);
  if (msgDiv) {
    const statusEl = msgDiv.querySelector('.message-status');
    if (statusEl) {
      statusEl.setAttribute('data-status', status);
      statusEl.innerHTML = getStatusIcon(status);
    }
  }
  
  // Update in messages array
  const message = messages.find(m => m.id === messageId);
  if (message) {
    message.status = status;
  }
}

function markMessagesAsRead(messageIds) {
  if (messageIds.length === 0) return;
  
  socket.emit('mark-messages-read', { messageIds }, (ack) => {
    // Messages marked as read
  });
}

function escapeHtml(s) {
  if (!s) return '';
  return s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

// Initialize - check URL for room ID
function init() {
  const urlParams = new URLSearchParams(window.location.search);
  const roomIdFromUrl = urlParams.get('room');
  
  if (roomIdFromUrl) {
    roomIdInput.value = roomIdFromUrl;
    showSection('joinRoomSection');
    checkRoom(roomIdFromUrl);
  }
}

// Show specific section
function showSection(sectionId) {
  createRoomSection.classList.add('hidden');
  joinRoomSection.classList.add('hidden');
  roomInfoSection.classList.add('hidden');
  roomLinkSection.classList.add('hidden');
  
  document.getElementById(sectionId).classList.remove('hidden');
}

// Generate random room ID
function generateRoomId() {
  return 'room-' + Math.random().toString(36).substring(2, 10);
}

// Create Room
createRoomBtn.addEventListener('click', () => {
  const user1Name = user1NameInput.value.trim();
  const user2Name = user2NameInput.value.trim();
  
  if (!user1Name || !user2Name) {
    alert('Please enter both participant names');
    return;
  }
  
  const roomId = generateRoomId();
  
  socket.emit('create-room', { roomId, user1Name, user2Name }, (res) => {
    if (!res || !res.ok) {
      alert('Failed to create room: ' + (res && res.error ? res.error : 'Unknown'));
      return;
    }
    
    localRoom = roomId;
    const roomUrl = window.location.origin + window.location.pathname + '?room=' + roomId;
    roomLinkInput.value = roomUrl;
    
    // Store room info
    currentRoomInfo = { user1Name, user2Name, roomId };
    
    showSection('roomLinkSection');
  });
});

// Copy Link
copyLinkBtn.addEventListener('click', () => {
  roomLinkInput.select();
  document.execCommand('copy');
  copyLinkBtn.textContent = '✓';
  setTimeout(() => {
    copyLinkBtn.textContent = '📋';
  }, 2000);
});

// Join Created Room
joinCreatedRoomBtn.addEventListener('click', () => {
  if (currentRoomInfo) {
    showRoomSlotSelection(currentRoomInfo.roomId, currentRoomInfo.user1Name, currentRoomInfo.user2Name, {
      user1: true,
      user2: true
    });
  }
});

// Switch to Join
switchToJoinBtn.addEventListener('click', () => {
  showSection('joinRoomSection');
});

// Switch to Create
switchToCreateBtn.addEventListener('click', () => {
  showSection('createRoomSection');
});

// Check Room
checkRoomBtn.addEventListener('click', () => {
  const roomId = roomIdInput.value.trim();
  if (!roomId) {
    alert('Please enter a room ID');
    return;
  }
  checkRoom(roomId);
});

function checkRoom(roomId) {
  socket.emit('get-room-info', { roomId }, (res) => {
    if (!res || !res.ok) {
      alert('Room not found: ' + (res && res.error ? res.error : 'Unknown'));
      return;
    }
    
    localRoom = roomId;
    showRoomSlotSelection(roomId, res.user1Name, res.user2Name, res.availableSlots);
  });
}

function showRoomSlotSelection(roomId, user1Name, user2Name, availableSlots) {
  currentRoomInfo = { roomId, user1Name, user2Name };
  
  // Update slot buttons
  const user1Slot = joinAsUser1Btn.querySelector('.slot-name');
  const user1Status = joinAsUser1Btn.querySelector('.slot-status');
  user1Slot.textContent = user1Name;
  user1Status.textContent = availableSlots.user1 ? 'Available' : 'Occupied';
  joinAsUser1Btn.disabled = !availableSlots.user1;
  
  const user2Slot = joinAsUser2Btn.querySelector('.slot-name');
  const user2Status = joinAsUser2Btn.querySelector('.slot-status');
  user2Slot.textContent = user2Name;
  user2Status.textContent = availableSlots.user2 ? 'Available' : 'Occupied';
  joinAsUser2Btn.disabled = !availableSlots.user2;
  
  showSection('roomInfoSection');
}

// Join as User1
joinAsUser1Btn.addEventListener('click', () => {
  joinRoomAsSlot('user1', currentRoomInfo.user1Name);
});

// Join as User2
joinAsUser2Btn.addEventListener('click', () => {
  joinRoomAsSlot('user2', currentRoomInfo.user2Name);
});

function joinRoomAsSlot(slot, username) {
  socket.emit('join-room', { roomId: localRoom, username, slot }, (res) => {
    if (!res || !res.ok) {
      alert('Failed to join room: ' + (res && res.error ? res.error : 'Unknown'));
      return;
    }
    
    localUsername = username;
    mySlot = slot;
    roomLabel.textContent = localRoom;
    participantsCountEl.textContent = res.participants || '1';
    joinArea.classList.add('hidden');
    chatArea.classList.remove('hidden');
    messageInput.focus();

    // Load chat history
    if (res.history) {
      res.history.forEach(msg => appendMessage(msg));
    }
  });
}

// Back to Join
backToJoinBtn.addEventListener('click', () => {
  showSection('joinRoomSection');
});

sendForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = messageInput.value.trim();
  if (!text) return;
  if (!socket.connected) {
    statusEl.textContent = 'Reconnecting...';
    socket.connect();
    // Wait for connect
    socket.once('connect', () => {
      sendMessage(text);
    });
  } else {
    sendMessage(text);
  }
});

function sendMessage(text) {
  socket.emit('send-message', { text }, (ack) => {
    if (ack && ack.ok) {
      messageInput.value = '';
      stopTyping();
    } else {
      console.warn('message send failed', ack);
    }
  });
}

// Typing indicator: notify server when user types
messageInput.addEventListener('input', () => {
  if (!isTyping) {
    isTyping = true;
    socket.emit('typing', { isTyping: true });
  }
  clearTimeout(typingTimer);
  typingTimer = setTimeout(() => {
    stopTyping();
  }, 700); // after 700ms of inactivity, stop typing
});

function stopTyping() {
  if (isTyping) {
    isTyping = false;
    socket.emit('typing', { isTyping: false });
  }
}

// Handle socket events
socket.on('message', (payload) => {
  appendMessage(payload);
});

socket.on('peer-joined', ({ username }) => {
  const div = document.createElement('div');
  div.className = 'msg other';
  div.innerHTML = `<em>${escapeHtml(username)} joined the room.</em>`;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
});

socket.on('peer-left', ({ username }) => {
  const div = document.createElement('div');
  div.className = 'msg other';
  div.innerHTML = `<em>${escapeHtml(username)} left the room.</em>`;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
});

socket.on('room-info', ({ participants }) => {
  participantsCountEl.textContent = participants;
});

socket.on('peer-typing', ({ username, isTyping }) => {
  if (isTyping) {
    typingEl.textContent = `${username} is typing...`;
    typingEl.classList.remove('hidden');
  } else {
    typingEl.classList.add('hidden');
  }
});

leaveBtn.addEventListener('click', () => {
  if (localRoom) {
    socket.emit('typing', { isTyping: false });
    socket.disconnect();
    // simply reload to reset UI and reconnect
    setTimeout(() => location.reload(), 200);
  }
});

// Menu toggle
menuBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  actionMenu.classList.toggle('hidden');
});

// Close menu when clicking outside
document.addEventListener('click', () => {
  actionMenu.classList.add('hidden');
});

// Back button
backBtn.addEventListener('click', () => {
  if (localRoom) {
    socket.emit('typing', { isTyping: false });
    socket.disconnect();
    setTimeout(() => location.reload(), 200);
  }
});

// Attach button placeholder
attachBtn.addEventListener('click', () => {
  alert('File attachment feature coming soon!');
});

// Edit Username
editUsernameBtn.addEventListener('click', () => {
  const newUsername = prompt('Enter new username:', localUsername);
  if (newUsername && newUsername.trim() && newUsername.trim() !== localUsername) {
    socket.emit('update-username', { username: newUsername.trim() }, (ack) => {
      if (ack && ack.ok) {
        localUsername = newUsername.trim();
        alert('Username updated successfully');
      } else {
        alert('Failed to update username');
      }
    });
  }
});

clearBtn.addEventListener('click', () => {
  socket.emit('clear-chat', (ack) => {
    if (ack && ack.ok) {
      messages = [];
      messagesEl.innerHTML = '';
    }
  });
});

exportBtn.addEventListener('click', () => {
  const content = messages.map(msg => `[${new Date(msg.ts).toLocaleString()}] ${msg.from}: ${msg.text}`).join('\n');
  const blob = new Blob([content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `chat-${localRoom}-${new Date().toISOString().split('T')[0]}.txt`;
  a.click();
  URL.revokeObjectURL(url);
});

messagesEl.addEventListener('click', (e) => {
  if (e.target.classList.contains('delete-btn')) {
    const messageId = e.target.getAttribute('data-id');
    socket.emit('delete-message', { messageId }, (ack) => {
      if (ack && ack.ok) {
        // Remove locally immediately
        const msgDiv = e.target.closest('.msg');
        if (msgDiv) msgDiv.remove();
        messages = messages.filter(msg => msg.id !== messageId);
      }
    });
  }
});

// Optional: reconnect behavior
socket.io.on('reconnect', () => {
  statusEl.textContent = 'Connected';
  if (localRoom && localUsername) {
    socket.emit('join-room', { roomId: localRoom, username: localUsername }, (res) => {
      if (res && res.ok) {
        participantsCountEl.textContent = res.participants || '1';
        // Load history again? But since reconnect, history might be loaded already, but to be safe
        if (res.history) {
          messagesEl.innerHTML = ''; // Clear and reload
          messages = [];
          res.history.forEach(msg => appendMessage(msg));
        }
      } else {
        // If rejoin fails, perhaps reload or alert
        alert('Failed to rejoin room after reconnect');
        location.reload();
      }
    });
  }
});

socket.on('disconnect', () => {
  statusEl.textContent = 'Disconnected';
});

socket.on('connect', () => {
  statusEl.textContent = 'Connected';
});

socket.on('message-deleted', ({ messageId }) => {
  const msgDiv = messagesEl.querySelector(`[data-message-id="${messageId}"]`);
  if (msgDiv) msgDiv.remove();
  messages = messages.filter(msg => msg.id !== messageId);
});

socket.on('chat-cleared', () => {
  messages = [];
  messagesEl.innerHTML = '';
});

socket.on('username-changed', ({ socketId, oldUsername, newUsername }) => {
  const div = document.createElement('div');
  div.className = 'msg other';
  div.innerHTML = `<em>${escapeHtml(oldUsername)} changed name to ${escapeHtml(newUsername)}</em>`;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
});

// Handle message status updates
socket.on('message-status-updated', ({ messageId, status }) => {
  updateMessageStatus(messageId, status);
});

// Mark visible messages as read when scrolling or focusing
let readCheckTimer;
function checkAndMarkVisibleMessages() {
  clearTimeout(readCheckTimer);
  readCheckTimer = setTimeout(() => {
    const unreadMessages = messages.filter(m => 
      m.senderSlot !== mySlot && (!m.status || m.status !== 'read')
    );
    if (unreadMessages.length > 0) {
      markMessagesAsRead(unreadMessages.map(m => m.id));
    }
  }, 500);
}

// Mark messages as read when viewing
messagesEl.addEventListener('scroll', checkAndMarkVisibleMessages);
window.addEventListener('focus', checkAndMarkVisibleMessages);

// Initialize on load
init();