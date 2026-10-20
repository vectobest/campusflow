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
    // Absent for accounts that only sign in with Google.
    passwordHash: { type: String, default: null },
    // Google's stable account identifier (the ID token's `sub`), set once linked.
    googleId: { type: String, default: undefined, unique: true, sparse: true },
    role: { type: String, enum: ROLES, default: 'participant' },
  },
  { timestamps: true },
);

userSchema.methods.toPublic = function toPublic() {
  return {
    id: this._id.toString(),
    email: this.email,
    role: this.role,
    signInMethods: { password: Boolean(this.passwordHash), google: Boolean(this.googleId) },
  };
};

export const User = mongoose.model('User', userSchema);
