import mongoose from 'mongoose';

export const ROLES = ['participant', 'researcher', 'admin'];

/**
 * Account identity. Holds the only personally identifying fields (email).
 * Never referenced from observation or analytics collections — those use
 * Participant.participantId instead.
 */
const userSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ROLES, default: 'participant' },
  },
  { timestamps: true },
);

userSchema.methods.toPublic = function toPublic() {
  return { id: this._id.toString(), email: this.email, role: this.role };
};

export const User = mongoose.model('User', userSchema);
