// index.js
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const crypto = require('crypto');
const { initDatabase, roomOps, participantOps, messageOps } = require('./database');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Initialize SQLite database
initDatabase();

// Clear all stale participant connections from previous server session
// This ensures rooms are accessible after server restart
participantOps.clearAllParticipants();

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
  socket.on('create-room', ({ roomId, user1Name, user2Name, passcode }, ack) => {
    if (!roomId || !user1Name || !user2Name) {
      return ack && ack({ ok: false, error: 'roomId, user1Name, and user2Name required' });
    }

    if (!passcode || passcode.trim().length < 4) {
      return ack && ack({ ok: false, error: 'Passcode must be at least 4 characters' });
    }

    try {
      roomOps.create(roomId, user1Name, user2Name, passcode.trim());
      ack && ack({ ok: true, roomId });
    } catch (error) {
      ack && ack({ ok: false, error: error.message || 'Room already exists' });
    }
  });

  // Get room info
  socket.on('get-room-info', ({ roomId, passcode }, ack) => {
    if (!roomId) {
      return ack && ack({ ok: false, error: 'roomId required' });
    }

    const room = roomOps.get(roomId);
    if (!room) {
      return ack && ack({ ok: false, error: 'Room not found', exists: false });
    }

    // Verify passcode
    if (!roomOps.verifyPasscode(roomId, passcode ? passcode.trim() : '')) {
      return ack && ack({ ok: false, error: 'Invalid passcode', invalidPasscode: true });
    }

    const availableSlots = participantOps.getAvailableSlots(roomId);

    ack && ack({ 
      ok: true, 
      exists: true,
      user1Name: room.user1_name,
      user2Name: room.user2_name,
      availableSlots
    });
  });

  socket.on('join-room', ({ roomId, username, slot, passcode }, ack) => {
    if (!roomId || !username) {
      return ack && ack({ ok: false, error: 'roomId and username required' });
    }

    // Verify room exists and passcode
    if (!roomOps.verifyPasscode(roomId, passcode ? passcode.trim() : '')) {
      const room = roomOps.get(roomId);
      if (!room) {
        return ack && ack({ ok: false, error: 'Room not found' });
      }
      return ack && ack({ ok: false, error: 'Invalid passcode' });
    }

    // Determine which slot to assign
    let assignedSlot = slot;
    if (!assignedSlot) {
      // Auto-assign to available slot
      const availableSlots = participantOps.getAvailableSlots(roomId);
      if (availableSlots.user1) {
        assignedSlot = 'user1';
      } else if (availableSlots.user2) {
        assignedSlot = 'user2';
      } else {
        return ack && ack({ ok: false, error: 'Room is full (2 participants max)' });
      }
    } else {
      // Check if requested slot is available
      if (!participantOps.isSlotAvailable(roomId, assignedSlot)) {
        // Slot appears occupied, but check if the socket actually exists (could be stale)
        const participant = participantOps.get(roomId, assignedSlot);
        
        if (participant && participant.socket_id) {
          // Check if this socket ID is actually connected
          const socketExists = io.sockets.sockets.has(participant.socket_id);
          
          if (!socketExists) {
            // Stale connection from previous server session, clear it
            console.log(`Clearing stale connection for ${assignedSlot} in room ${roomId}`);
            participantOps.leave(roomId, assignedSlot);
          } else {
            // Socket is actually connected, slot is genuinely taken
            return ack && ack({ ok: false, error: `${assignedSlot} slot is already taken` });
          }
        }
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

    // Update participant slot in database
    participantOps.join(roomId, assignedSlot, socket.id, username);

    // Send chat history from database
    const history = messageOps.getByRoom(roomId);
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

    const messageId = crypto.randomUUID();
    const payload = {
      text,
      from: username,
      id: messageId,
      senderId: socket.id,
      senderSlot: slot,
      ts: Date.now(),
      status: 'sent'
    };

    // Save to database
    messageOps.create({
      id: messageId,
      roomId,
      senderSlot: slot,
      senderId: socket.id,
      from: username,
      text,
      ts: payload.ts,
      status: 'sent'
    });

    // Emit to everyone in the room (including sender)
    io.in(roomId).emit('message', payload);
    ack && ack({ ok: true, messageId: payload.id });

    // If there's another participant, mark as delivered immediately
    const room = io.sockets.adapter.rooms.get(roomId);
    if (room && room.size > 1) {
      // Update status to delivered in database
      messageOps.updateStatus(messageId, 'delivered');
      // Notify sender about delivery
      socket.emit('message-status-updated', { messageId: payload.id, status: 'delivered' });
    }
  });

  socket.on('delete-message', ({ messageId }, ack) => {
    const roomId = socket.data.roomId;
    if (!roomId) return ack && ack({ ok: false, error: 'Not in a room' });

    // Delete from database
    messageOps.delete(messageId);

    // Broadcast deletion to the room
    io.in(roomId).emit('message-deleted', { messageId });
    ack && ack({ ok: true });
  });

  socket.on('clear-chat', (ack) => {
    const roomId = socket.data.roomId;
    if (!roomId) return ack && ack({ ok: false, error: 'Not in a room' });

    // Clear messages from database
    messageOps.clearByRoom(roomId);

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

    // Get current messages from database to check senders
    const history = messageOps.getByRoom(roomId);
    
    // Filter messages that are not from current user
    const messagesToUpdate = messageIds.filter(msgId => {
      const message = history.find(m => m.id === msgId);
      return message && message.senderId !== socket.id;
    });

    // Update message statuses in database
    if (messagesToUpdate.length > 0) {
      messageOps.markAsRead(messagesToUpdate);
      
      // Notify senders about read status
      messagesToUpdate.forEach(msgId => {
        const message = history.find(m => m.id === msgId);
        if (message) {
          io.to(message.senderId).emit('message-status-updated', { 
            messageId: msgId, 
            status: 'read' 
          });
        }
      });
    }

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
    
    if (roomId && slot) {
      // Clear participant slot in database
      participantOps.leave(roomId, slot);
      
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
