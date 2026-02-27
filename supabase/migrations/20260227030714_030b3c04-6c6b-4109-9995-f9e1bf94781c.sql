
-- 1. New course_layouts table (1:1 with courses)
CREATE TABLE public.course_layouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL UNIQUE REFERENCES public.courses(id) ON DELETE CASCADE,
  layout_data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.course_layouts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can select course_layouts"
  ON public.course_layouts FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can insert course_layouts"
  ON public.course_layouts FOR INSERT
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can update course_layouts"
  ON public.course_layouts FOR UPDATE
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can delete course_layouts"
  ON public.course_layouts FOR DELETE
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER update_course_layouts_updated_at
  BEFORE UPDATE ON public.course_layouts
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- 2. Add layout columns to submissions
ALTER TABLE public.submissions
  ADD COLUMN has_layout boolean NOT NULL DEFAULT false,
  ADD COLUMN layout_data jsonb;
