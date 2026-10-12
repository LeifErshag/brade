// Express 4 does not catch errors from async route handlers: a rejected
// promise never reaches the error middleware and becomes an unhandled
// rejection instead. Wrap every async handler so its errors go to next().
export function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve()
      .then(() => fn(req, res, next))
      .catch(next);
  };
}
