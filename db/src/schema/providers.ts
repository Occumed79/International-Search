import { pgTable, text, serial, timestamp, doublePrecision, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const providersTable = pgTable("providers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  organizationName: text("organization_name"),
  npi: text("npi"),
  providerType: text("provider_type").notNull(),
  specialty: text("specialty"),
  address: text("address"),
  city: text("city"),
  stateRegion: text("state_region"),
  postalCode: text("postal_code"),
  country: text("country").notNull().default("US"),
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
  phone: text("phone"),
  website: text("website"),
  lastUpdated: timestamp("last_updated", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertProviderSchema = createInsertSchema(providersTable).omit({ id: true, createdAt: true });
export type InsertProvider = z.infer<typeof insertProviderSchema>;
export type Provider = typeof providersTable.$inferSelect;

export const pricesTable = pgTable("prices", {
  id: serial("id").primaryKey(),
  providerId: integer("provider_id").notNull().references(() => providersTable.id),
  serviceQuery: text("service_query").notNull(),
  normalizedService: text("normalized_service").notNull(),
  billingCode: text("billing_code"),
  exactPrice: doublePrecision("exact_price").notNull(),
  currency: text("currency").notNull().default("USD"),
  priceType: text("price_type").notNull(),
  evidenceText: text("evidence_text"),
  sourceUrl: text("source_url").notNull(),
  sourceType: text("source_type").notNull(),
  timestampFound: timestamp("timestamp_found", { withTimezone: true }).notNull().defaultNow(),
  verificationStatus: text("verification_status").notNull().default("verified_exact_posted_price"),
  confidenceScore: doublePrecision("confidence_score").notNull().default(0.9),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertPriceSchema = createInsertSchema(pricesTable).omit({ id: true, createdAt: true });
export type InsertPrice = z.infer<typeof insertPriceSchema>;
export type Price = typeof pricesTable.$inferSelect;

export const bookmarksTable = pgTable("bookmarks", {
  id: serial("id").primaryKey(),
  providerId: integer("provider_id").notNull().references(() => providersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertBookmarkSchema = createInsertSchema(bookmarksTable).omit({ id: true, createdAt: true });
export type InsertBookmark = z.infer<typeof insertBookmarkSchema>;
export type Bookmark = typeof bookmarksTable.$inferSelect;

export const searchHistoryTable = pgTable("search_history", {
  id: serial("id").primaryKey(),
  query: text("query").notNull(),
  resultCount: integer("result_count").notNull().default(0),
  searchedAt: timestamp("searched_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertSearchHistorySchema = createInsertSchema(searchHistoryTable).omit({ id: true, searchedAt: true });
export type InsertSearchHistory = z.infer<typeof insertSearchHistorySchema>;
export type SearchHistory = typeof searchHistoryTable.$inferSelect;

export const crawlLogsTable = pgTable("crawl_logs", {
  id: serial("id").primaryKey(),
  connectorName: text("connector_name").notNull(),
  status: text("status").notNull(),
  recordsIngested: integer("records_ingested").notNull().default(0),
  errorMessage: text("error_message"),
  crawledAt: timestamp("crawled_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertCrawlLogSchema = createInsertSchema(crawlLogsTable).omit({ id: true, crawledAt: true });
export type InsertCrawlLog = z.infer<typeof insertCrawlLogSchema>;
export type CrawlLog = typeof crawlLogsTable.$inferSelect;
