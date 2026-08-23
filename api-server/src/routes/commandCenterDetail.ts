import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.get("/command-center/provider-detail/:id", async (req, res) => {
  try {
    if (!pool) throw new Error("Provider database is unavailable.");
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Invalid provider identifier." });
      return;
    }
    const result = await pool.query(`
      SELECT id, external_id, name, organization_name, site_name, site_display, facility_type, network_status, visible,
        country, state_region, city, county, address1, address2, postal_code, latitude, longitude, coordinate_quality,
        phone, fax, contact_name, timezone, hours_scheduling, billing_terms, source_created_at, source_created_by,
        harvest, services, last_appointment, pricing_available, agreement_component_ids, service_component_ids,
        activity_2026, activity_2026_category, agreement_2026, agreement_date_2026, pricing_service_components_2026,
        internal_notes, examinee_instructions, audit_history, source_status
      FROM network_provider_snapshot
      WHERE id=$1
      LIMIT 1
    `, [id]);
    if (!result.rows[0]) {
      res.status(404).json({ error: "Provider not found." });
      return;
    }
    const row = result.rows[0];
    res.json({
      id: Number(row.id), externalId: row.external_id == null ? null : Number(row.external_id), name: row.name,
      organizationName: row.organization_name, siteName: row.site_name, siteDisplay: row.site_display,
      facilityType: row.facility_type, networkStatus: row.network_status, visible: row.visible,
      country: row.country, stateRegion: row.state_region, city: row.city, county: row.county,
      address1: row.address1, address2: row.address2, postalCode: row.postal_code,
      latitude: row.latitude == null ? null : Number(row.latitude), longitude: row.longitude == null ? null : Number(row.longitude),
      coordinateQuality: row.coordinate_quality, phone: row.phone, fax: row.fax, contactName: row.contact_name,
      timezone: row.timezone, hoursScheduling: row.hours_scheduling, billingTerms: row.billing_terms,
      sourceCreatedAt: row.source_created_at, sourceCreatedBy: row.source_created_by, harvest: row.harvest,
      services: Array.isArray(row.services) ? row.services : [], lastAppointment: row.last_appointment,
      pricingAvailable: Boolean(row.pricing_available), approvedIds: row.agreement_component_ids, signedIds: row.service_component_ids,
      activity2026: row.activity_2026, activity2026Category: row.activity_2026_category,
      agreement2026: row.agreement_2026, agreementDate2026: row.agreement_date_2026,
      pricingServiceComponents2026: row.pricing_service_components_2026, internalNotes: row.internal_notes,
      examineeInstructions: row.examinee_instructions, auditHistory: row.audit_history, sourceStatus: row.source_status,
    });
  } catch (error) {
    logger.warn({ error }, "Rich Command Center provider detail failed");
    res.status(500).json({ error: "Could not load provider details." });
  }
});

export default router;
