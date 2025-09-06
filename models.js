// models.mjs
import mongoose from 'mongoose';
const { Schema } = mongoose;

const ChannelSchema = new Schema({
  userId: { type: String, required: true, index: true },
  name: { type: String, required: true, default: 'New Channel' },
  createdAt: { type: Date, default: Date.now }
});

const ImageSchema = new Schema({
  userId: { type: String, required: true, index: true },
  filename: String,
  contentType: String,
  data: Buffer,
  createdAt: { type: Date, default: Date.now }
});

const MessageSchema = new Schema({
  channelId: { type: Schema.Types.ObjectId, required: true, index: true },
  userId: { type: String, required: true, index: true },
  role: { type: String, enum: ['user','assistant','system'], default: 'user' },
  text: { type: String, default: '' },
  imageId: { type: Schema.Types.ObjectId, ref: 'Image', default: null },
  pending: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

export const Channel = mongoose.model('Channel', ChannelSchema);
export const Image = mongoose.model('Image', ImageSchema);
export const Message = mongoose.model('Message', MessageSchema);
