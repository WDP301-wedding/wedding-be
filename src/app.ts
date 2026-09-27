import express, { type Express } from 'express';

export function createApp(): Express {
  return express();
}
