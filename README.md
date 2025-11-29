# simple-socket-chat
Simple 1-to-1 chat with Express and Socket.IO

## Features

### � Security
- **Passcode Protection** - Each room requires a passcode to join
- **Minimum 4 characters** for passcode strength
- **Server-side validation** ensures only authorized users can access rooms
- **Passcode required** for both creating and joining rooms

### �🔗 URL-Based Room Access
- **Create rooms** with custom participant names (Person 1 & Person 2)
- **Shareable links** - Get a unique URL for each room
- **Direct access** - Share the URL and join instantly

### 👥 Named Participants
- Pre-define participant names when creating a room
- Join as specific person (Person 1 or Person 2)
- Auto-assign to available slot if not specified
- See which slots are occupied/available

### ✏️ Username Editing
- Edit your username anytime during chat
- Real-time notification when someone changes their name
- Updates visible to all participants

### 💬 Chat Features
- **Real-time messaging** with Socket.IO
- **Message status indicators** (WhatsApp-style):
  - ✓ Single tick - Message sent
  - ✓✓ Double tick (gray) - Message delivered
  - ✓✓ Double tick (blue) - Message read
- **Chat history** - Messages persist even after reconnect
- **Typing indicators** - See when someone is typing
- **Delete messages** - Remove your own messages
- **Clear chat** - Clear entire chat history for all participants
- **Export chat** - Download chat as text file
- **Auto-reconnect** - Seamlessly reconnect after network issues

### 📱 Mobile-Friendly UI
- WhatsApp-inspired design
- Responsive layout for all screen sizes
- Touch-optimized controls
- Dark mode support

## Usage

### Creating a Room
1. Open the app
2. Enter names for Person 1 and Person 2
3. **Set a secure passcode** (minimum 4 characters)
4. Click "Create Room & Get Link"
5. **Share both the URL and passcode** with the other person
6. Click "Join Room" to enter the chat

### Joining via URL
1. Open the shared URL (e.g., `http://localhost:3000/?room=room-abc123`)
2. **Enter the room passcode** provided by the room creator
3. Click "Check Room"
4. Select which person you want to join as
5. Start chatting!

### Joining Existing Room
1. Click "Join Existing Room" on the home screen
2. Enter the room ID
3. **Enter the room passcode**
4. Click "Check Room"
5. Choose your participant slot

## Installation

```bash
npm install
npm start
```

Server runs on `http://localhost:3000`

## Tech Stack
- **Backend**: Node.js, Express, Socket.IO
- **Frontend**: Vanilla JavaScript, HTML5, CSS3
- **Database**: SQLite3 (via better-sqlite3) - Persistent storage
- **Real-time**: WebSockets via Socket.IO

## Database Persistence
All chat data is now stored in a SQLite database (`chat.db`), which means:
- **Rooms persist** across server restarts
- **Messages are saved** permanently until deleted
- **User sessions** can be resumed after disconnection
- **Zero data loss** even if server crashes or restarts

### Database Schema
- **rooms** - Stores room metadata (ID, participant names, passcode)
- **participants** - Tracks current connections and slot assignments
- **messages** - All chat messages with status tracking

Even if the server shuts down due to an issue, all rooms, users, and messages remain available when users rejoin.
