import mongoose, { Schema, Document } from 'mongoose';
import { Kit } from '../types/schemas.js';

// User Schema
export interface IUser extends Document {
  email: string;
  passwordHash: string;
  name: string;
  createdAt: Date;
}

const UserSchema = new Schema<IUser>({
  email: { type: String, required: true, unique: true, index: true },
  passwordHash: { type: String, required: true },
  name: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});

export const UserModel = mongoose.models.User || mongoose.model<IUser>('User', UserSchema);

// Kit Schema
export interface IKitDoc extends Document {
  userId: string;
  kit: Kit;
  title: string;
  company: string;
  createdAt: Date;
  updatedAt: Date;
}

const KitMongoSchema = new Schema<IKitDoc>(
  {
    userId: { type: String, required: true, index: true },
    title: { type: String, required: true },
    company: { type: String, required: true },
    kit: { type: Schema.Types.Mixed, required: true },
  },
  { timestamps: true }
);

export const KitModel = mongoose.models.Kit || mongoose.model<IKitDoc>('Kit', KitMongoSchema);

// In-Memory Storage Fallback (for zero-dependency offline runs and local testing)
interface MemoryUser {
  id: string;
  email: string;
  passwordHash: string;
  name: string;
  createdAt: Date;
}

interface MemoryKit {
  id: string;
  userId: string;
  title: string;
  company: string;
  kit: Kit;
  createdAt: Date;
  updatedAt: Date;
}

export class MemoryStore {
  private static users: Map<string, MemoryUser> = new Map();
  private static kits: Map<string, MemoryKit> = new Map();

  static async findUserByEmail(email: string) {
    if (mongoose.connection.readyState === 1) {
      const doc: any = await UserModel.findOne({ email }).lean();
      if (!doc) return null;
      return {
        id: doc._id.toString(),
        email: doc.email,
        passwordHash: doc.passwordHash,
        name: doc.name,
        createdAt: doc.createdAt,
      };
    }
    for (const u of this.users.values()) {
      if (u.email.toLowerCase() === email.toLowerCase()) return u;
    }
    return null;
  }

  static async createUser(user: { email: string; passwordHash: string; name: string }) {
    if (mongoose.connection.readyState === 1) {
      const doc: any = await UserModel.create(user);
      return { id: doc._id.toString(), email: doc.email, name: doc.name };
    }
    const id = `user_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const newU: MemoryUser = { id, ...user, createdAt: new Date() };
    this.users.set(id, newU);
    return { id, email: newU.email, name: newU.name };
  }

  static async findUserById(id: string) {
    if (mongoose.connection.readyState === 1) {
      const doc: any = await UserModel.findById(id).lean();
      if (!doc) return null;
      return {
        id: doc._id.toString(),
        email: doc.email,
        name: doc.name,
      };
    }
    return this.users.get(id) || null;
  }

  static async createKit(userId: string, kit: Kit) {
    if (!userId) {
      throw new Error('User ID is required to create a kit. Please log in again.');
    }
    const title = `${kit.role.title} at ${kit.source.company}`;
    const company = kit.source.company;

    if (mongoose.connection.readyState === 1) {
      const doc: any = await KitModel.create({ userId, title, company, kit });
      return { id: doc._id.toString(), userId, title, company, kit, createdAt: doc.createdAt, updatedAt: doc.updatedAt };
    }
    const id = `kit_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const now = new Date();
    const memKit: MemoryKit = { id, userId, title, company, kit, createdAt: now, updatedAt: now };
    this.kits.set(id, memKit);
    return memKit;
  }

  static async getKitsForUser(userId: string) {
    if (mongoose.connection.readyState === 1) {
      const docs: any[] = await KitModel.find({ userId }).sort({ updatedAt: -1 }).lean();
      return docs.map(d => ({
        id: d._id.toString(),
        userId: d.userId,
        title: d.title,
        company: d.company,
        kit: d.kit,
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
      }));
    }
    return Array.from(this.kits.values())
      .filter(k => k.userId === userId)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  }

  static async getKitById(id: string, userId: string) {
    if (mongoose.connection.readyState === 1) {
      const doc: any = await KitModel.findOne({ _id: id, userId }).lean();
      if (!doc) return null;
      return {
        id: doc._id.toString(),
        userId: doc.userId,
        title: doc.title,
        company: doc.company,
        kit: doc.kit,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
      };
    }
    const k = this.kits.get(id);
    if (!k || k.userId !== userId) return null;
    return k;
  }

  static async updateKit(id: string, userId: string, updatedKit: Kit) {
    const title = `${updatedKit.role.title} at ${updatedKit.source.company}`;
    const company = updatedKit.source.company;

    if (mongoose.connection.readyState === 1) {
      const doc: any = await KitModel.findOneAndUpdate(
        { _id: id, userId },
        { kit: updatedKit, title, company },
        { new: true }
      ).lean();
      if (!doc) return null;
      return {
        id: doc._id.toString(),
        userId: doc.userId,
        title: doc.title,
        company: doc.company,
        kit: doc.kit,
        updatedAt: doc.updatedAt,
      };
    }
    const existing = this.kits.get(id);
    if (!existing || existing.userId !== userId) return null;
    existing.kit = updatedKit;
    existing.title = title;
    existing.company = company;
    existing.updatedAt = new Date();
    this.kits.set(id, existing);
    return existing;
  }

  static async deleteKit(id: string, userId: string) {
    if (mongoose.connection.readyState === 1) {
      const res = await KitModel.deleteOne({ _id: id, userId });
      return res.deletedCount > 0;
    }
    const existing = this.kits.get(id);
    if (!existing || existing.userId !== userId) return false;
    this.kits.delete(id);
    return true;
  }
}
