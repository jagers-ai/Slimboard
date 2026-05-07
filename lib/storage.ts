import { createAdminClient } from "@/lib/supabase/admin";

export const WHITEBOARD_BUCKET = "whiteboard-images";

export function buildImagePaths(input: {
  userId: string;
  noteId: string;
  originalExtension: string;
}) {
  const basePath = `${input.userId}/${input.noteId}`;

  return {
    originalPath: `${basePath}/original.${input.originalExtension}`,
    analysisPath: `${basePath}/analysis.jpg`,
  };
}

export async function uploadImageObject(input: {
  path: string;
  buffer: Buffer;
  contentType: string;
}) {
  const supabase = createAdminClient();
  const { error } = await supabase.storage
    .from(WHITEBOARD_BUCKET)
    .upload(input.path, input.buffer, {
      contentType: input.contentType,
      upsert: true,
    });

  if (error) {
    throw error;
  }
}

export async function downloadImageObject(path: string) {
  const supabase = createAdminClient();
  const { data, error } = await supabase.storage.from(WHITEBOARD_BUCKET).download(path);

  if (error || !data) {
    throw error ?? new Error("Could not download image.");
  }

  return Buffer.from(await data.arrayBuffer());
}

export async function createSignedImageUrl(path: string, expiresIn = 60 * 10) {
  const supabase = createAdminClient();
  const { data, error } = await supabase.storage
    .from(WHITEBOARD_BUCKET)
    .createSignedUrl(path, expiresIn);

  if (error) {
    return null;
  }

  return data.signedUrl;
}

export async function createSignedImageUrls(paths: string[], expiresIn = 60 * 10) {
  const normalizedPaths = Array.from(new Set(paths.filter(Boolean)));
  const urls = new Map<string, string | null>();

  if (normalizedPaths.length === 0) {
    return urls;
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase.storage
    .from(WHITEBOARD_BUCKET)
    .createSignedUrls(normalizedPaths, expiresIn);

  if (error) {
    normalizedPaths.forEach((path) => urls.set(path, null));
    return urls;
  }

  data?.forEach((item) => {
    if (item.path) {
      urls.set(item.path, item.signedUrl);
    }
  });

  return urls;
}

export async function removeImageObjects(paths: string[]) {
  const supabase = createAdminClient();
  const normalized = paths.filter(Boolean);

  if (normalized.length === 0) {
    return;
  }

  const { error } = await supabase.storage.from(WHITEBOARD_BUCKET).remove(normalized);

  if (error) {
    throw error;
  }
}
