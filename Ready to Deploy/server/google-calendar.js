/**
 * Google Calendar Integration
 * Creates, updates, and deletes calendar events for waiting list orders
 */

import { google } from 'googleapis';

// Initialize Google Calendar API
const auth = new google.auth.GoogleAuth({
  keyFile: process.env.GOOGLE_SERVICE_ACCOUNT_KEY ? JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY) : undefined,
  keyFilename: process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH,
  scopes: ['https://www.googleapis.com/auth/calendar.events'],
});

const calendar = auth ? google.calendar({ version: 'v3', auth }) : null;

// Get calendar ID from environment variable (default: 'primary')
const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID || 'primary';

/**
 * Parse date and time from order
 * Format: event_date = "DD/MM/YYYY", delivery_time = "HH.MM" (optional)
 * Returns: { startDateTime, endDateTime } in ISO 8601 format
 */
function parseOrderDateTime(eventDate, deliveryTime) {
  if (!eventDate) {
    throw new Error('Event date is required');
  }

  // Parse date (format: DD/MM/YYYY)
  const dateParts = eventDate.split('/');
  if (dateParts.length !== 3) {
    throw new Error(`Invalid date format: ${eventDate}. Expected DD/MM/YYYY`);
  }

  const day = parseInt(dateParts[0]);
  const month = parseInt(dateParts[1]) - 1; // Month is 0-indexed
  let year = parseInt(dateParts[2]);
  if (year < 100) year += 2000; // Handle 2-digit years

  // Parse time (format: HH.MM or HH:MM, default: 10:00)
  let hours = 10;
  let minutes = 0;

  if (deliveryTime) {
    // Support both "HH.MM" and "HH:MM" formats
    const timeStr = deliveryTime.replace('.', ':');
    const timeParts = timeStr.split(':');
    if (timeParts.length >= 2) {
      hours = parseInt(timeParts[0]) || 10;
      minutes = parseInt(timeParts[1]) || 0;
    }
  }

  // Create date object in Asia/Jakarta timezone
  const startDate = new Date(year, month, day, hours, minutes);
  
  // End time is 1 hour after start (default event duration)
  const endDate = new Date(startDate);
  endDate.setHours(endDate.getHours() + 1);

  // Format as ISO 8601 with timezone
  const startDateTime = startDate.toISOString();
  const endDateTime = endDate.toISOString();

  return { startDateTime, endDateTime };
}

/**
 * Format order details for calendar event description
 */
function formatOrderDescription(order) {
  let description = `📋 **Order Details**\n\n`;
  description += `**Order ID:** ${order.id}\n`;
  description += `**Customer:** ${order.customer_name}\n`;
  description += `**Phone:** ${order.phone_number}\n`;
  description += `**Address:** ${order.address}\n\n`;

  if (order.event_name) {
    description += `**Event Name:** ${order.event_name}\n`;
  }
  if (order.event_duration) {
    description += `**Event Duration:** ${order.event_duration}\n`;
  }
  description += `**Delivery Date:** ${order.event_date}\n`;
  if (order.delivery_time) {
    description += `**Delivery Time:** ${order.delivery_time}\n`;
  }

  description += `\n**Items:**\n`;
  (order.items || []).forEach(item => {
    description += `• ${item.quantity}x ${item.name}\n`;
  });

  if (order.notes && order.notes.length > 0) {
    description += `\n**Notes:**\n`;
    order.notes.forEach(note => {
      description += `• ${note}\n`;
    });
  }

  description += `\n**Status:** ${order.status || 'pending'}`;

  return description;
}

/**
 * Create calendar event for waiting list order
 * @param {Object} order - Order object from waiting list
 * @returns {Promise<string>} Calendar event ID
 */
export async function createCalendarEvent(order) {
  try {
    // Check if calendar API is available
    if (!calendar) {
      return null;
    }

    // Check if calendar ID is configured
    if (!CALENDAR_ID) {
      return null;
    }

    // Parse date and time
    let startDateTime, endDateTime;
    try {
      const parsed = parseOrderDateTime(order.event_date, order.delivery_time);
      startDateTime = parsed.startDateTime;
      endDateTime = parsed.endDateTime;
    } catch (error) {
      console.error(`❌ Error parsing date/time for order ${order.id}:`, error.message);
      return null;
    }

    // Format event data
    const eventTitle = `Order ${order.id} - ${order.customer_name}`;
    const eventDescription = formatOrderDescription(order);
    const eventLocation = order.address || '';

    const event = {
      summary: eventTitle,
      description: eventDescription,
      start: {
        dateTime: startDateTime,
        timeZone: 'Asia/Jakarta',
      },
      end: {
        dateTime: endDateTime,
        timeZone: 'Asia/Jakarta',
      },
      location: eventLocation,
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'popup', minutes: 1440 }, // 1 day before
          { method: 'popup', minutes: 120 },  // 2 hours before
        ],
      },
    };

    // Create event
    const response = await calendar.events.insert({
      calendarId: CALENDAR_ID,
      requestBody: event,
    });

    const eventId = response.data.id;
    return eventId;
  } catch (error) {
    console.error(`❌ Error creating calendar event for order ${order.id}:`, error.message);
    // Don't throw - allow order saving to continue
    return null;
  }
}

/**
 * Update calendar event for waiting list order
 * @param {string} eventId - Calendar event ID
 * @param {Object} order - Updated order object
 * @returns {Promise<string>} Updated calendar event ID (same as input)
 */
export async function updateCalendarEvent(eventId, order) {
  try {
    // Check if calendar API is available
    if (!calendar) {
      return eventId;
    }

    if (!eventId) {
      // No existing event, create new one
      return await createCalendarEvent(order);
    }

    if (!CALENDAR_ID) {
      return eventId;
    }

    // Parse date and time
    let startDateTime, endDateTime;
    try {
      const parsed = parseOrderDateTime(order.event_date, order.delivery_time);
      startDateTime = parsed.startDateTime;
      endDateTime = parsed.endDateTime;
    } catch (error) {
      console.error(`❌ Error parsing date/time for order ${order.id}:`, error.message);
      return eventId; // Return existing event ID
    }

    // Format event data
    const eventTitle = `Order ${order.id} - ${order.customer_name}`;
    const eventDescription = formatOrderDescription(order);
    const eventLocation = order.address || '';

    const event = {
      summary: eventTitle,
      description: eventDescription,
      start: {
        dateTime: startDateTime,
        timeZone: 'Asia/Jakarta',
      },
      end: {
        dateTime: endDateTime,
        timeZone: 'Asia/Jakarta',
      },
      location: eventLocation,
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'popup', minutes: 1440 }, // 1 day before
          { method: 'popup', minutes: 120 },  // 2 hours before
        ],
      },
    };

    // Update event
    await calendar.events.update({
      calendarId: CALENDAR_ID,
      eventId: eventId,
      requestBody: event,
    });
    return eventId;
  } catch (error) {
    // If event not found, try creating new one
    if (error.code === 404) {
      return await createCalendarEvent(order);
    }
    
    console.error(`❌ Error updating calendar event for order ${order.id}:`, error.message);
    return eventId; // Return existing event ID on error
  }
}

/**
 * Delete calendar event for waiting list order
 * @param {string} eventId - Calendar event ID
 * @param {string} orderId - Order ID (for logging)
 * @returns {Promise<boolean>} Success status
 */
export async function deleteCalendarEvent(eventId, orderId) {
  try {
    // Check if calendar API is available
    if (!calendar) {
      return false;
    }

    if (!eventId) {
      return false;
    }

    if (!CALENDAR_ID) {
      return false;
    }

    await calendar.events.delete({
      calendarId: CALENDAR_ID,
      eventId: eventId,
    });
    return true;
  } catch (error) {
    // If event not found, that's okay (already deleted)
    if (error.code === 404) {
      return true;
    }
    
    console.error(`❌ Error deleting calendar event for order ${orderId}:`, error.message);
    return false;
  }
}
