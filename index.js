// index.js
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

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

  socket.on('join-room', ({ roomId, username }, ack) => {
    if (!roomId || !username) {
      return ack && ack({ ok: false, error: 'roomId and username required' });
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

    // Inform the joining socket about existing participants count
    ack && ack({ ok: true, participants: numClients + 1 });

    // Notify other participant
    socket.to(roomId).emit('peer-joined', { username, id: socket.id });

    // Send room state (optional)
    io.in(roomId).emit('room-info', { roomId, participants: numClients + 1 });
  });

  socket.on('send-message', ({ text }, ack) => {
    const username = socket.data.username || 'Anonymous';
    const roomId = socket.data.roomId;
    if (!roomId) return ack && ack({ ok: false, error: 'Not in a room' });

    const payload = {
      text,
      from: username,
      id: socket.id,
      ts: Date.now()
    };

    // Emit to everyone in the room (including sender)
    io.in(roomId).emit('message', payload);
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
    if (roomId) {
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
