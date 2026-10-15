import frappe

POS_PROFILE_UPDATED_EVENT = "posa_pos_profile_updated"


def publish_pos_profile_update(doc, method=None):
    """Publish a realtime event when a POS Profile is updated."""
    if not doc or not doc.name:
        return

    frappe.publish_realtime(
        POS_PROFILE_UPDATED_EVENT,
        {
            "pos_profile": doc.name,
            "company": doc.company,
        },
        after_commit=True,
    )
