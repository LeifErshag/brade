import { z } from "zod";

// Validate request body against a Zod schema
// Returns 400 with validation errors if invalid — never passes bad data downstream
export function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({
        error: "Validation failed",
        issues: result.error.issues.map(i => ({ path: i.path, message: i.message })),
      });
    }
    req.body = result.data; // replace with parsed/sanitised data
    return next();
  };
}