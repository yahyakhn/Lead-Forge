import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto"
import type { ScryptOptions } from "node:crypto"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { prisma } from "@/lib/db"
import type { Role } from "@/generated/prisma/client"

const SESSION_COOKIE = "leadforge_session"
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

const SCRYPT_N = 32768
const SCRYPT_R = 8
const SCRYPT_P = 1
const SCRYPT_KEYLEN = 64

function scrypt(
  password: string,
  salt: string,
  keylen: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keylen, options, (err, derivedKey) =>
      err ? reject(err) : resolve(derivedKey),
    )
  })
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex")
  const hash = await scrypt(password, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 64 * 1024 * 1024,
  })
  return `${SCRYPT_N}:${SCRYPT_R}:${SCRYPT_P}:${salt}:${hash.toString("hex")}`
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const [n, r, p, salt, hashHex] = stored.split(":")
  const expected = Buffer.from(hashHex, "hex")
  const actual = await scrypt(password, salt, expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: 64 * 1024 * 1024,
  })
  return timingSafeEqual(actual, expected)
}

export interface SessionData {
  user: { id: string; name: string; email: string; role: Role }
  organization: { id: string; name: string }
}

export async function createSession(
  userId: string,
  organizationId: string,
): Promise<void> {
  const token = randomBytes(32).toString("base64url")
  await prisma.session.create({
    data: {
      token,
      userId,
      organizationId,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    },
  })
  const store = await cookies()
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  })
}

export async function getSession(): Promise<SessionData | null> {
  const store = await cookies()
  const token = store.get(SESSION_COOKIE)?.value
  if (!token) return null
  const session = await prisma.session.findUnique({
    where: { token },
    include: { user: { include: { organization: true } } },
  })
  if (!session || session.expiresAt < new Date()) return null
  return {
    user: {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
      role: session.user.role,
    },
    organization: {
      id: session.organizationId,
      name: session.user.organization.name,
    },
  }
}

export async function requireSession(): Promise<SessionData> {
  const session = await getSession()
  if (!session) redirect("/login")
  return session
}

export async function destroySession(): Promise<void> {
  const store = await cookies()
  const token = store.get(SESSION_COOKIE)?.value
  if (token) {
    await prisma.session.deleteMany({ where: { token } })
    store.delete(SESSION_COOKIE)
  }
}
