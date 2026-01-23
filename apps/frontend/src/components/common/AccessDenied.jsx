import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui';

export default function AccessDenied({ title = 'Access Denied', message = 'You do not have permission to view this section. Contact an administrator to request access.' }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        {message}
      </CardContent>
    </Card>
  );
}
