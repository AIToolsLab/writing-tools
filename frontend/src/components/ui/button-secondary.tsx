import * as React from "react";
import { Button } from "@/components/ui/button";

export function ButtonSecondary(
  props: React.ComponentProps<"button"> & { children?: React.ReactNode }
) {
  const { children, ...rest } = props;
  return (
    <Button variant="secondary" {...rest}>
      {children ?? "Secondary"}
    </Button>
  );
}

export default ButtonSecondary;
