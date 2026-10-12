// Validate a request property against a Zod schema: req.body by default, or
// req.query with validate(schema, "query").
// Returns 400 with validation errors if invalid — never passes bad data downstream
// Note: assigning req.query works in Express 4; Express 5 makes it a read-only getter.
export function validate(schema, source = "body") {
  return (req, res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      return res.status(400).json({
        error: "Validation failed",
        issues: result.error.issues.map(i => ({ path: i.path, message: i.message })),
      });
    }
    req[source] = result.data; // replace with parsed/sanitised data
    return next();
  };
}