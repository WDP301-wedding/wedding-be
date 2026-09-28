import type { Request, RequestHandler, Response } from 'express';
import { z } from 'zod';

import { ValidationError, type ErrorDetail } from '../errors/app-error.js';

const requestLocations = ['params', 'query', 'headers', 'body'] as const;
const validatedRequests = new WeakMap<Response, Record<string, unknown>>();

type RequestLocation = (typeof requestLocations)[number];

export type RequestSchemas = Partial<Record<RequestLocation, z.ZodType>>;

export type ValidatedRequest<Schemas extends RequestSchemas> = {
  readonly [Location in keyof Schemas]: Schemas[Location] extends z.ZodType
    ? z.output<Schemas[Location]>
    : never;
};

export function strictWriteSchema<const Shape extends z.ZodRawShape>(
  shape: Shape,
): z.ZodObject<Shape> {
  return z.strictObject(shape);
}

export function validateRequest<const Schemas extends RequestSchemas>(
  schemas: Schemas,
): RequestHandler {
  return async (request, response, next) => {
    const parsedRequest: Record<string, unknown> = {};

    for (const location of requestLocations) {
      const schema = schemas[location];
      if (schema === undefined) {
        continue;
      }

      const result = await schema.safeParseAsync(readRequestLocation(request, location));
      if (!result.success) {
        next(new ValidationError(result.error.issues.flatMap(toErrorDetails)));
        return;
      }

      parsedRequest[location] = result.data;
    }

    validatedRequests.set(response, parsedRequest);
    next();
  };
}

export function validatedRequest<const Schemas extends RequestSchemas>(
  response: Response,
  schemas: Schemas,
): ValidatedRequest<Schemas> {
  void schemas;
  const input = validatedRequests.get(response);
  if (input === undefined) {
    throw new Error('The request has not passed through validateRequest.');
  }

  return input as ValidatedRequest<Schemas>;
}

function readRequestLocation(request: Request, location: RequestLocation): unknown {
  switch (location) {
    case 'params':
      return request.params;
    case 'query':
      return request.query;
    case 'headers':
      return request.headers;
    case 'body':
      return request.body as unknown;
  }
}

function toErrorDetails(issue: z.ZodIssue): readonly ErrorDetail[] {
  if (issue.code === 'unrecognized_keys') {
    return issue.keys.map((key) => ({
      path: [...issue.path, key].map(String).join('.'),
      code: issue.code,
      message: issue.message,
    }));
  }

  return [
    {
      path: issue.path.map(String).join('.'),
      code: issue.code,
      message: issue.message,
    },
  ];
}
