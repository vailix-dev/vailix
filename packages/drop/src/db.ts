import mongoose from 'mongoose';

export function createKeyModel(retentionDays: number = 14) {
    const KeySchema = new mongoose.Schema({
        rpi: { type: Buffer, required: true, unique: true, index: true }, // Store as 16 bytes binary
        metadata: { type: mongoose.Schema.Types.Mixed, default: null },
        createdAt: { type: Date, default: Date.now, expires: `${retentionDays}d` },
    });

    return mongoose.model('Key', KeySchema);
}
