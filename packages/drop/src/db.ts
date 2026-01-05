import mongoose from 'mongoose';

const KeySchema = new mongoose.Schema({
    rpi: { type: Buffer, required: true, unique: true, index: true }, // Store as 16 bytes binary
    metadata: { type: mongoose.Schema.Types.Mixed, default: null },
    createdAt: { type: Date, default: Date.now, expires: '14d' },
});

export const KeyModel = mongoose.model('Key', KeySchema);
