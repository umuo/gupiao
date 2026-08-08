ALTER TABLE `users` ADD `role` text DEFAULT 'user' NOT NULL;
--> statement-breakpoint
UPDATE `users`
SET `role` = 'superadmin'
WHERE `id` = (
  SELECT `id` FROM `users`
  ORDER BY `created_at` ASC, `id` ASC
  LIMIT 1
)
AND NOT EXISTS (
  SELECT 1 FROM `users` WHERE `role` = 'superadmin'
);
