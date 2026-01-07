const mongoose = require('mongoose');
const crypto = require('crypto');

let gridFSBucket; // for attachments

async function initDatabase() {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/simple-socket-chat';

  await mongoose.connect(uri, {
    autoIndex: true,
  });

  // Initialize GridFS bucket for attachments
  gridFSBucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, {
    bucketName: 'attachments',
  });

  console.log('MongoDB connected:', uri);
}

function getGridFSBucket() {
  if (!gridFSBucket) {
    throw new Error('GridFSBucket not initialized. Call initDatabase() first.');
  }
  return gridFSBucket;
}

const roomSchema = new mongoose.Schema(
  {
    roomId: { type: String, unique: true, index: true, required: true },
    user1_name: { type: String, required: true },
    user2_name: { type: String, required: true },
    passcodeHash: { type: String, required: true },
  },
  { timestamps: true }
);

const participantSchema = new mongoose.Schema(
  {
    roomId: { type: String, index: true, required: true },
    slot: { type: String, enum: ['user1', 'user2'], required: true },
    socket_id: { type: String, default: null },
    username: { type: String, default: null },
  },
  { timestamps: true }
);
participantSchema.index({ roomId: 1, slot: 1 }, { unique: true });

const messageSchema = new mongoose.Schema(
  {
    id: { type: String, unique: true, index: true, required: true },
    roomId: { type: String, index: true, required: true },
    senderSlot: { type: String, enum: ['user1', 'user2'], required: true },
    senderId: { type: String, required: true },
    from: { type: String, required: true },
    text: { type: String, required: false, default: '' },
    ts: { type: Number, required: true },
    status: { type: String, enum: ['sent', 'delivered', 'read'], default: 'sent' },
    // attachment metadata (optional) when message has photo/video
    attachment: {
      type: {
        fileId: { type: mongoose.Schema.Types.ObjectId, required: true },
        filename: { type: String, required: true },
        mimeType: { type: String, required: true },
        size: { type: Number, required: true },
      },
      required: false,
    },
  },
  { timestamps: true }
);

const Room = mongoose.model('Room', roomSchema);
const Participant = mongoose.model('Participant', participantSchema);
const Message = mongoose.model('Message', messageSchema);

function hashPasscode(passcode) {
  return crypto.createHash('sha256').update(passcode).digest('hex');
}

const roomOps = {
  async create(roomId, user1Name, user2Name, passcode) {
    const passcodeHash = hashPasscode(passcode);

    const exists = await Room.findOne({ roomId }).lean();
    if (exists) {
      throw new Error('Room already exists');
    }

    await Room.create({
      roomId,
      user1_name: user1Name,
      user2_name: user2Name,
      passcodeHash,
    });

    await Participant.create({ roomId, slot: 'user1' });
    await Participant.create({ roomId, slot: 'user2' });
  },

  async get(roomId) {
    return Room.findOne({ roomId }).lean();
  },

  async verifyPasscode(roomId, passcode) {
    if (!passcode) return false;
    const room = await Room.findOne({ roomId }).lean();
    if (!room) return false;
    const candidate = hashPasscode(passcode);
    return candidate === room.passcodeHash;
  },
};

const participantOps = {
  async clearAllParticipants() {
    await Participant.updateMany(
      {},
      {
        $set: {
          socket_id: null,
          username: null,
        },
      }
    );
  },

  async getAvailableSlots(roomId) {
    const parts = await Participant.find({ roomId }).lean();

    const info = { user1: true, user2: true };

    for (const p of parts) {
      if (p.slot === 'user1' && p.socket_id) info.user1 = false;
      if (p.slot === 'user2' && p.socket_id) info.user2 = false;
    }

    return info;
  },

  async isSlotAvailable(roomId, slot) {
    const p = await Participant.findOne({ roomId, slot }).lean();
    return !p || !p.socket_id;
  },

  async get(roomId, slot) {
    return Participant.findOne({ roomId, slot }).lean();
  },

  async join(roomId, slot, socketId, username) {
    await Participant.updateOne(
      { roomId, slot },
      {
        $set: {
          roomId,
          slot,
          socket_id: socketId,
          username,
        },
      },
      { upsert: true }
    );
  },

  async leave(roomId, slot) {
    await Participant.updateOne(
      { roomId, slot },
      {
        $set: { socket_id: null, username: null },
      }
    );
  },
};

const messageOps = {
  async create(msg) {
    await Message.create(msg);
  },

  async getByRoom(roomId) {
    const docs = await Message.find({ roomId }).sort({ ts: 1 }).lean();
    return docs;
  },

  async updateStatus(messageId, status) {
    await Message.updateOne({ id: messageId }, { $set: { status } });
  },

  async delete(messageId) {
    const msg = await Message.findOne({ id: messageId }).lean();
    if (msg && msg.attachment && msg.attachment.fileId) {
      const bucket = getGridFSBucket();
      try {
        await bucket.delete(msg.attachment.fileId);
      } catch (e) {
        // ignore if already gone
      }
    }
    await Message.deleteOne({ id: messageId });
  },

  async clearByRoom(roomId) {
    const msgs = await Message.find({ roomId, 'attachment.fileId': { $exists: true } }).lean();
    const bucket = getGridFSBucket();
    for (const msg of msgs) {
      try {
        await bucket.delete(msg.attachment.fileId);
      } catch (e) {
        // ignore
      }
    }
    await Message.deleteMany({ roomId });
  },

  async markAsRead(messageIds) {
    if (!Array.isArray(messageIds) || messageIds.length === 0) return;
    await Message.updateMany(
      { id: { $in: messageIds } },
      { $set: { status: 'read' } }
    );
  },

  async createWithAttachment({ messageId, roomId, senderSlot, senderId, from, text, ts, fileStream, filename, mimeType, size }) {
    const bucket = getGridFSBucket();

    const uploadStream = bucket.openUploadStream(filename, {
      contentType: mimeType,
      metadata: { roomId, senderId },
    });

    return new Promise((resolve, reject) => {
      fileStream
        .pipe(uploadStream)
        .on('error', reject)
        .on('finish', async () => {
          try {
            const msgDoc = await Message.create({
              id: messageId,
              roomId,
              senderSlot,
              senderId,
              from,
              text,
              ts,
              status: 'sent',
              attachment: {
                fileId: uploadStream.id,
                filename,
                mimeType,
                size,
              },
            });
            resolve(msgDoc.toObject());
          } catch (e) {
            reject(e);
          }
        });
    });
  },

  getAttachmentStream(fileId) {
    const bucket = getGridFSBucket();
    return bucket.openDownloadStream(fileId);
  },
};

module.exports = {
  initDatabase,
  roomOps,
  participantOps,
  messageOps,
};
