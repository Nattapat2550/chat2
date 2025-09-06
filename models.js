import mongoose from 'mongoose';

const Schema = mongoose.Schema;

// Channel schema
export const ChannelSchema = new Schema({
  userId: { type: String, required: true },
  name: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});

export const Channel = mongoose.model('Channel', ChannelSchema);

// Image schema
export const ImageSchema = new Schema({
  userId: { type: String, required: true },
  filename: { type: String, required: true },
  contentType: { type: String, required: true },
  data: { type: Buffer, required: true },
  createdAt: { type: Date, default: Date.now }
});

export const Image = mongoose.model('Image', ImageSchema);

// Message schema
export const MessageSchema = new Schema({
  channelId: { type: Schema.Types.ObjectId, required: true },
  userId: { type: String, required: true },
  role: { type: String, enum: ['user', 'assistant', 'system'], required: true },
  text: { type: String, default: '' },
  imageId: { type: Schema.Types.ObjectId, ref: 'Image', default: null },
  pending: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

export const Message = mongoose.model('Message', MessageSchema);
