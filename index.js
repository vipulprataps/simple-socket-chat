// index.js
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// In-memory chat history per room
const chatHistory = new Map();

// Room metadata: stores room configuration
const roomMetadata = new Map();
// Structure: { roomId: { user1Name: string, user2Name: string, participants: { user1: socketId | null, user2: socketId | null } } }

// Serve static files from /public
app.use(express.static(path.join(__dirname, 'public')));

// Simple GET for health
app.get('/health', (req, res) => res.send({ ok: true }));

/**
 * Room model:
 * - Clients join a room by name (roomId)
 * - We expect at most 2 participants per room for 1-to-1 chat
 */
io.on('connection', (socket) => {
  console.log('socket connected:', socket.id);

  // Create or get room metadata
  socket.on('create-room', ({ roomId, user1Name, user2Name }, ack) => {
    if (!roomId || !user1Name || !user2Name) {
      return ack && ack({ ok: false, error: 'roomId, user1Name, and user2Name required' });
    }

    // Check if room already exists
    if (roomMetadata.has(roomId)) {
      return ack && ack({ ok: false, error: 'Room already exists' });
    }

    // Create room metadata
    roomMetadata.set(roomId, {
      user1Name,
      user2Name,
      participants: { user1: null, user2: null }
    });

    ack && ack({ ok: true, roomId });
  });

  // Get room info
  socket.on('get-room-info', ({ roomId }, ack) => {
    if (!roomId) {
      return ack && ack({ ok: false, error: 'roomId required' });
    }

    const metadata = roomMetadata.get(roomId);
    if (!metadata) {
      return ack && ack({ ok: false, error: 'Room not found', exists: false });
    }

    ack && ack({ 
      ok: true, 
      exists: true,
      user1Name: metadata.user1Name,
      user2Name: metadata.user2Name,
      availableSlots: {
        user1: metadata.participants.user1 === null,
        user2: metadata.participants.user2 === null
      }
    });
  });

  socket.on('join-room', ({ roomId, username, slot }, ack) => {
    if (!roomId || !username) {
      return ack && ack({ ok: false, error: 'roomId and username required' });
    }

    const metadata = roomMetadata.get(roomId);
    if (!metadata) {
      return ack && ack({ ok: false, error: 'Room not found' });
    }

    // Determine which slot to assign
    let assignedSlot = slot;
    if (!assignedSlot) {
      // Auto-assign to available slot
      if (metadata.participants.user1 === null) {
        assignedSlot = 'user1';
      } else if (metadata.participants.user2 === null) {
        assignedSlot = 'user2';
      } else {
        return ack && ack({ ok: false, error: 'Room is full (2 participants max)' });
      }
    } else {
      // Check if requested slot is available
      if (metadata.participants[assignedSlot] !== null) {
        return ack && ack({ ok: false, error: `${assignedSlot} slot is already taken` });
      }
    }

    const room = io.sockets.adapter.rooms.get(roomId);
    const numClients = room ? room.size : 0;

    // Reject if room already has 2 participants
    if (numClients >= 2) {
      return ack && ack({ ok: false, error: 'Room is full (2 participants max)' });
    }

    socket.join(roomId);
    socket.data.username = username;
    socket.data.roomId = roomId;
    socket.data.slot = assignedSlot;

    // Update participant slot
    metadata.participants[assignedSlot] = socket.id;

    // Send chat history
    const history = chatHistory.get(roomId) || [];
    ack && ack({ ok: true, participants: numClients + 1, history, slot: assignedSlot });

    // Notify other participant
    socket.to(roomId).emit('peer-joined', { username, id: socket.id });

    // Send room state (optional)
    io.in(roomId).emit('room-info', { roomId, participants: numClients + 1 });
  });

  socket.on('send-message', ({ text }, ack) => {
    const username = socket.data.username || 'Anonymous';
    const roomId = socket.data.roomId;
    const slot = socket.data.slot;
    if (!roomId) return ack && ack({ ok: false, error: 'Not in a room' });

    const payload = {
      text,
      from: username,
      id: crypto.randomUUID(),
      senderId: socket.id,
      senderSlot: slot, // Add slot information
      ts: Date.now(),
      status: 'sent' // Initial status
    };

    // Add to history
    if (!chatHistory.has(roomId)) {
      chatHistory.set(roomId, []);
    }
    chatHistory.get(roomId).push(payload);

    // Emit to everyone in the room (including sender)
    io.in(roomId).emit('message', payload);
    ack && ack({ ok: true, messageId: payload.id });

    // If there's another participant, mark as delivered immediately
    const room = io.sockets.adapter.rooms.get(roomId);
    if (room && room.size > 1) {
      // Update status to delivered
      payload.status = 'delivered';
      // Notify sender about delivery
      socket.emit('message-status-updated', { messageId: payload.id, status: 'delivered' });
    }
  });

  socket.on('delete-message', ({ messageId }, ack) => {
    const roomId = socket.data.roomId;
    if (!roomId) return ack && ack({ ok: false, error: 'Not in a room' });

    // Remove from history
    const history = chatHistory.get(roomId);
    if (history) {
      const index = history.findIndex(msg => msg.id === messageId);
      if (index !== -1) {
        history.splice(index, 1);
      }
    }

    // Broadcast deletion to the room
    io.in(roomId).emit('message-deleted', { messageId });
    ack && ack({ ok: true });
  });

  socket.on('clear-chat', (ack) => {
    const roomId = socket.data.roomId;
    if (!roomId) return ack && ack({ ok: false, error: 'Not in a room' });

    // Clear history
    chatHistory.delete(roomId);

    // Broadcast clear to the room
    io.in(roomId).emit('chat-cleared');
    ack && ack({ ok: true });
  });

  // Update username
  socket.on('update-username', ({ username }, ack) => {
    if (!username || !username.trim()) {
      return ack && ack({ ok: false, error: 'Username required' });
    }

    const roomId = socket.data.roomId;
    if (!roomId) return ack && ack({ ok: false, error: 'Not in a room' });

    const oldUsername = socket.data.username;
    socket.data.username = username.trim();

    // Notify room about username change
    io.in(roomId).emit('username-changed', { 
      socketId: socket.id, 
      oldUsername, 
      newUsername: username.trim() 
    });

    ack && ack({ ok: true });
  });

  // Mark messages as read
  socket.on('mark-messages-read', ({ messageIds }, ack) => {
    const roomId = socket.data.roomId;
    if (!roomId) return ack && ack({ ok: false, error: 'Not in a room' });

    const history = chatHistory.get(roomId);
    if (!history) return ack && ack({ ok: true });

    // Update message statuses
    messageIds.forEach(msgId => {
      const message = history.find(m => m.id === msgId);
      if (message && message.senderId !== socket.id) {
        message.status = 'read';
        // Notify the sender
        io.to(message.senderId).emit('message-status-updated', { 
          messageId: msgId, 
          status: 'read' 
        });
      }
    });

    ack && ack({ ok: true });
  });

  socket.on('typing', ({ isTyping }) => {
    const username = socket.data.username || 'Anonymous';
    const roomId = socket.data.roomId;
    if (!roomId) return;
    // inform others in room
    socket.to(roomId).emit('peer-typing', { username, isTyping });
  });

  socket.on('disconnecting', () => {
    const roomId = socket.data.roomId;
    const username = socket.data.username;
    const slot = socket.data.slot;
    
    if (roomId) {
      // Clear participant slot
      const metadata = roomMetadata.get(roomId);
      if (metadata && slot) {
        metadata.participants[slot] = null;
      }
      
      // notify peers
      socket.to(roomId).emit('peer-left', { username, id: socket.id });
    }
  });

  socket.on('disconnect', (reason) => {
    console.log('socket disconnected:', socket.id, reason);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
