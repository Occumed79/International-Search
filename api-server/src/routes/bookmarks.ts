import { Router, type IRouter } from "express";
import { db, bookmarksTable, providersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { CreateBookmarkBody, DeleteBookmarkParams } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/bookmarks", async (_req, res): Promise<void> => {
  const bookmarks = await db
    .select({
      id: bookmarksTable.id,
      providerId: providersTable.id,
      providerName: providersTable.name,
      providerType: providersTable.providerType,
      city: providersTable.city,
      stateRegion: providersTable.stateRegion,
      country: providersTable.country,
      createdAt: bookmarksTable.createdAt,
    })
    .from(bookmarksTable)
    .innerJoin(providersTable, eq(bookmarksTable.providerId, providersTable.id));

  res.json(
    bookmarks.map((b) => ({
      ...b,
      createdAt: b.createdAt.toISOString(),
    }))
  );
});

router.post("/bookmarks", async (req, res): Promise<void> => {
  const parsed = CreateBookmarkBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [provider] = await db
    .select()
    .from(providersTable)
    .where(eq(providersTable.id, parsed.data.providerId));

  if (!provider) {
    res.status(404).json({ error: "Provider not found" });
    return;
  }

  const [bookmark] = await db
    .insert(bookmarksTable)
    .values({ providerId: parsed.data.providerId })
    .returning();

  res.status(201).json({
    id: bookmark.id,
    providerId: provider.id,
    providerName: provider.name,
    providerType: provider.providerType,
    city: provider.city,
    stateRegion: provider.stateRegion,
    country: provider.country,
    createdAt: bookmark.createdAt.toISOString(),
  });
});

router.delete("/bookmarks/:id", async (req, res): Promise<void> => {
  const params = DeleteBookmarkParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [deleted] = await db
    .delete(bookmarksTable)
    .where(eq(bookmarksTable.id, params.data.id))
    .returning();

  if (!deleted) {
    res.status(404).json({ error: "Bookmark not found" });
    return;
  }

  res.sendStatus(204);
});

export default router;
