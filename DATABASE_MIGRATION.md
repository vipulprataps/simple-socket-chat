# SQLite Database Migration Guide

## Overview
The application has been migrated from in-memory storage to persistent SQLite database storage. All rooms, messages, and participant data now persist across server restarts.

## What Changed

### Before (In-Memory)
- Used JavaScript `Map` objects for `chatHistory` and `roomMetadata`
- All data lost when server stopped or restarted
- No persistence between sessions

### After (SQLite Database)
- All data stored in `chat.db` SQLite database
- Rooms, messages, and participants persist permanently
- Server restarts don't affect existing conversations
- Users can rejoin rooms after server downtime

## New Files

### `database.js`
Database service module with the following operations:

#### Room Operations (`roomOps`)
- `create(roomId, user1Name, user2Name, passcode)` - Create new room
- `get(roomId)` - Get room details
- `exists(roomId)` - Check if room exists
- `verifyPasscode(roomId, passcode)` - Validate room passcode
- `delete(roomId)` - Delete room and all related data

#### Participant Operations (`participantOps`)
- `join(roomId, slot, socketId, username)` - User joins a slot
- `leave(roomId, slot)` - User leaves a slot
- `getBySocket(socketId)` - Find participant by socket ID
- `getAvailableSlots(roomId)` - Check which slots are available
- `isSlotAvailable(roomId, slot)` - Check if specific slot is free

#### Message Operations (`messageOps`)
- `create(messageData)` - Save new message
- `getByRoom(roomId)` - Get all messages for a room
- `updateStatus(messageId, status)` - Update message status
- `delete(messageId)` - Delete a message
- `clearByRoom(roomId)` - Clear all messages in a room
- `markAsRead(messageIds)` - Mark multiple messages as read

### `chat.db`
SQLite database file containing three tables:

#### `rooms` table
```sql
room_id TEXT PRIMARY KEY
user1_name TEXT NOT NULL
user2_name TEXT NOT NULL
passcode TEXT NOT NULL
created_at INTEGER DEFAULT (strftime('%s', 'now'))
```

#### `participants` table
```sql
room_id TEXT NOT NULL
slot TEXT NOT NULL CHECK(slot IN ('user1', 'user2'))
socket_id TEXT
username TEXT
last_active INTEGER DEFAULT (strftime('%s', 'now'))
PRIMARY KEY (room_id, slot)
FOREIGN KEY (room_id) REFERENCES rooms(room_id) ON DELETE CASCADE
```

#### `messages` table
```sql
id TEXT PRIMARY KEY
room_id TEXT NOT NULL
sender_slot TEXT NOT NULL CHECK(sender_slot IN ('user1', 'user2'))
sender_id TEXT NOT NULL
sender_name TEXT NOT NULL
text TEXT NOT NULL
timestamp INTEGER NOT NULL
status TEXT DEFAULT 'sent' CHECK(status IN ('sent', 'delivered', 'read'))
FOREIGN KEY (room_id) REFERENCES rooms(room_id) ON DELETE CASCADE
```

## Modified Files

### `index.js`
- Removed `chatHistory` and `roomMetadata` Maps
- Added `database.js` import
- Replaced all Map operations with database calls:
  - `roomMetadata.set()` → `roomOps.create()`
  - `roomMetadata.get()` → `roomOps.get()`
  - `chatHistory.get()` → `messageOps.getByRoom()`
  - `chatHistory.set()` → `messageOps.create()`
  - And more...

### `package.json`
- Added dependency: `better-sqlite3` (SQLite driver)

### `README.md`
- Added "Database Persistence" section
- Updated Tech Stack to include SQLite3

## Database Features

### Automatic Cleanup
- Foreign key constraints ensure data integrity
- Deleting a room automatically deletes all messages and participants (CASCADE)
- Indexes optimize query performance

### Status Tracking
- Messages track delivery status (sent/delivered/read)
- Participant last activity timestamps

### Concurrent Access
- SQLite handles concurrent reads efficiently
- Write operations are serialized by SQLite

## Testing the Migration

1. **Create a room** and send some messages
2. **Stop the server** (Ctrl+C)
3. **Restart the server** (`npm start`)
4. **Rejoin the same room** with the passcode
5. **Verify** all messages are still there

## Database Inspection

View all rooms:
```bash
sqlite3 chat.db "SELECT * FROM rooms;"
```

View all messages:
```bash
sqlite3 chat.db "SELECT * FROM messages;"
```

View database schema:
```bash
sqlite3 chat.db ".schema"
```

Count messages per room:
```bash
sqlite3 chat.db "SELECT room_id, COUNT(*) as msg_count FROM messages GROUP BY room_id;"
```

## Backup & Restore

### Backup
```bash
cp chat.db chat.db.backup
```

### Restore
```bash
cp chat.db.backup chat.db
```

### Export to SQL
```bash
sqlite3 chat.db .dump > backup.sql
```

## Performance Considerations

- **Indexes**: Created on `room_id` and `timestamp` for fast queries
- **Synchronous I/O**: better-sqlite3 uses synchronous operations (simpler code, good for moderate traffic)
- **No ORM**: Direct SQL queries for maximum performance
- **Efficient queries**: Minimal database calls per operation

## Future Enhancements

Possible improvements:
- Add message search functionality
- Implement message editing
- Add file/image upload support
- Room expiration (auto-delete old inactive rooms)
- User presence tracking
- Message encryption

## Troubleshooting

### Database locked error
- Only one write at a time is allowed
- better-sqlite3 handles this automatically with queuing

### Database file missing
- Will be created automatically on first server start
- Check file permissions if errors occur

### Migration from old data
- Old in-memory data is NOT migrated automatically
- Start fresh after migration
