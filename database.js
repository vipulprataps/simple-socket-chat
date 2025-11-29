// database.js - SQLite database service
const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'chat.db');
const db = new Database(dbPath);

// Enable foreign keys
db.pragma('foreign_keys = ON');

// Initialize database schema
function initDatabase() {
  // Create rooms table
  db.exec(`
    CREATE TABLE IF NOT EXISTS rooms (
      room_id TEXT PRIMARY KEY,
      user1_name TEXT NOT NULL,
      user2_name TEXT NOT NULL,
      passcode TEXT NOT NULL,
      created_at INTEGER DEFAULT (strftime('%s', 'now'))
    )
  `);

  // Create participants table (tracks current connections)
  db.exec(`
    CREATE TABLE IF NOT EXISTS participants (
      room_id TEXT NOT NULL,
      slot TEXT NOT NULL CHECK(slot IN ('user1', 'user2')),
      socket_id TEXT,
      username TEXT,
      last_active INTEGER DEFAULT (strftime('%s', 'now')),
      PRIMARY KEY (room_id, slot),
      FOREIGN KEY (room_id) REFERENCES rooms(room_id) ON DELETE CASCADE
    )
  `);

  // Create messages table
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL,
      sender_slot TEXT NOT NULL CHECK(sender_slot IN ('user1', 'user2')),
      sender_id TEXT NOT NULL,
      sender_name TEXT NOT NULL,
      text TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      status TEXT DEFAULT 'sent' CHECK(status IN ('sent', 'delivered', 'read')),
      FOREIGN KEY (room_id) REFERENCES rooms(room_id) ON DELETE CASCADE
    )
  `);

  // Create indexes for better query performance
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_messages_room_id ON messages(room_id);
    CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
    CREATE INDEX IF NOT EXISTS idx_participants_room_id ON participants(room_id);
  `);

  console.log('Database initialized successfully');
}

// Room operations
const roomOps = {
  create: (roomId, user1Name, user2Name, passcode) => {
    const stmt = db.prepare(`
      INSERT INTO rooms (room_id, user1_name, user2_name, passcode)
      VALUES (?, ?, ?, ?)
    `);
    
    try {
      stmt.run(roomId, user1Name, user2Name, passcode);
      
      // Initialize participant slots
      const participantStmt = db.prepare(`
        INSERT INTO participants (room_id, slot, socket_id, username)
        VALUES (?, ?, NULL, NULL)
      `);
      participantStmt.run(roomId, 'user1');
      participantStmt.run(roomId, 'user2');
      
      return true;
    } catch (err) {
      if (err.code === 'SQLITE_CONSTRAINT') {
        throw new Error('Room already exists');
      }
      throw err;
    }
  },

  get: (roomId) => {
    const stmt = db.prepare(`
      SELECT room_id, user1_name, user2_name, passcode, created_at
      FROM rooms
      WHERE room_id = ?
    `);
    return stmt.get(roomId);
  },

  exists: (roomId) => {
    const room = roomOps.get(roomId);
    return room !== undefined;
  },

  verifyPasscode: (roomId, passcode) => {
    const stmt = db.prepare(`
      SELECT passcode FROM rooms WHERE room_id = ?
    `);
    const room = stmt.get(roomId);
    return room && room.passcode === passcode;
  },

  delete: (roomId) => {
    const stmt = db.prepare('DELETE FROM rooms WHERE room_id = ?');
    stmt.run(roomId);
  }
};

// Participant operations
const participantOps = {
  join: (roomId, slot, socketId, username) => {
    const stmt = db.prepare(`
      UPDATE participants
      SET socket_id = ?, username = ?, last_active = strftime('%s', 'now')
      WHERE room_id = ? AND slot = ?
    `);
    stmt.run(socketId, username, roomId, slot);
  },

  leave: (roomId, slot) => {
    const stmt = db.prepare(`
      UPDATE participants
      SET socket_id = NULL, last_active = strftime('%s', 'now')
      WHERE room_id = ? AND slot = ?
    `);
    stmt.run(roomId, slot);
  },

  getBySocket: (socketId) => {
    const stmt = db.prepare(`
      SELECT room_id, slot, username
      FROM participants
      WHERE socket_id = ?
    `);
    return stmt.get(socketId);
  },

  getAvailableSlots: (roomId) => {
    const stmt = db.prepare(`
      SELECT slot, socket_id FROM participants WHERE room_id = ?
    `);
    const participants = stmt.all(roomId);
    return {
      user1: participants.find(p => p.slot === 'user1')?.socket_id === null,
      user2: participants.find(p => p.slot === 'user2')?.socket_id === null
    };
  },

  isSlotAvailable: (roomId, slot) => {
    const stmt = db.prepare(`
      SELECT socket_id FROM participants WHERE room_id = ? AND slot = ?
    `);
    const participant = stmt.get(roomId, slot);
    return participant && participant.socket_id === null;
  },

  get: (roomId, slot) => {
    const stmt = db.prepare(`
      SELECT room_id, slot, socket_id, username, last_active
      FROM participants
      WHERE room_id = ? AND slot = ?
    `);
    return stmt.get(roomId, slot);
  },

  clearAllParticipants: () => {
    const stmt = db.prepare(`
      UPDATE participants SET socket_id = NULL
    `);
    const result = stmt.run();
    console.log(`Cleared ${result.changes} stale participant connections`);
    return result.changes;
  }
};

// Message operations
const messageOps = {
  create: (messageData) => {
    const stmt = db.prepare(`
      INSERT INTO messages (id, room_id, sender_slot, sender_id, sender_name, text, timestamp, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      messageData.id,
      messageData.roomId,
      messageData.senderSlot,
      messageData.senderId,
      messageData.from,
      messageData.text,
      messageData.ts,
      messageData.status || 'sent'
    );
  },

  getByRoom: (roomId) => {
    const stmt = db.prepare(`
      SELECT id, sender_slot as senderSlot, sender_id as senderId, 
             sender_name as "from", text, timestamp as ts, status
      FROM messages
      WHERE room_id = ?
      ORDER BY timestamp ASC
    `);
    return stmt.all(roomId);
  },

  updateStatus: (messageId, status) => {
    const stmt = db.prepare(`
      UPDATE messages SET status = ? WHERE id = ?
    `);
    stmt.run(status, messageId);
  },

  delete: (messageId) => {
    const stmt = db.prepare('DELETE FROM messages WHERE id = ?');
    stmt.run(messageId);
  },

  clearByRoom: (roomId) => {
    const stmt = db.prepare('DELETE FROM messages WHERE room_id = ?');
    stmt.run(roomId);
  },

  markAsRead: (messageIds) => {
    if (messageIds.length === 0) return;
    
    const placeholders = messageIds.map(() => '?').join(',');
    const stmt = db.prepare(`
      UPDATE messages SET status = 'read' WHERE id IN (${placeholders})
    `);
    stmt.run(...messageIds);
  }
};

// Cleanup operations
const cleanupOps = {
  // Remove old inactive rooms (optional - e.g., older than 30 days with no activity)
  removeInactiveRooms: (daysOld = 30) => {
    const cutoffTime = Math.floor(Date.now() / 1000) - (daysOld * 24 * 60 * 60);
    const stmt = db.prepare(`
      DELETE FROM rooms
      WHERE room_id IN (
        SELECT r.room_id
        FROM rooms r
        LEFT JOIN participants p ON r.room_id = p.room_id
        WHERE p.last_active < ?
        GROUP BY r.room_id
      )
    `);
    const result = stmt.run(cutoffTime);
    console.log(`Cleaned up ${result.changes} inactive rooms`);
  }
};

module.exports = {
  initDatabase,
  roomOps,
  participantOps,
  messageOps,
  cleanupOps,
  db // Export db instance for custom queries if needed
};
