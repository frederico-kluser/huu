import React, { ReactNode } from "react";
import TypePageStyle from "../../types/pageStyle";

interface GapProps {
  horizontal?: boolean;
  size:
  | 4
  | 8
  | 12
  | 16
  | 20
  | 24
  | 32
  | 40
  | 48
  | 56
  | 64
  | 72
  | 80
  | 88
  | 96
  | 104
  | 112
  | 120
  | 128
  | 200;
  children?: ReactNode | ReactNode[];
}

const Gap: React.FC<GapProps> = ({ horizontal = false, size, children }) => {
  const gapStyle = {
    display: horizontal ? "flex" : "grid",
    gap: `${size}px`,
  };

  return <div style={gapStyle}>{children}</div>;
};

export default Gap;