'use strict';

class AppError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.status = status;
  }
}

class ValidationError extends AppError {
  constructor(msg) { super(msg, 400); }
}

class NotFoundError extends AppError {
  constructor(msg = 'Not found') { super(msg, 404); }
}

module.exports = { AppError, ValidationError, NotFoundError };
