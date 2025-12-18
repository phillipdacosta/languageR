import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'displayName',
  standalone: true,
  pure: true // Important: pure pipes are memoized and only re-run when input changes
})
export class DisplayNamePipe implements PipeTransform {
  transform(studentOrName: any): string {
    // Return early if no value
    if (!studentOrName) {
      return 'Unknown';
    }

    // If it's already a simple string, return it
    if (typeof studentOrName === 'string') {
      // Handle composite names like "FirstName LastName"
      const rawName = studentOrName.trim();
      if (rawName.includes(' ')) {
        const parts = rawName.split(' ');
        return `${parts[0]} ${parts[parts.length - 1].charAt(0)}.`;
      }
      return rawName;
    }

    // If it's an object with firstName/lastName
    if (studentOrName.firstName && studentOrName.lastName) {
      return `${studentOrName.firstName} ${studentOrName.lastName.charAt(0)}.`;
    }

    // If it has a name property
    if (studentOrName.name) {
      const rawName = studentOrName.name;
      // Recursively handle the string
      return this.transform(rawName);
    }

    // If it's a lesson object with student or tutor
    if (studentOrName.lesson) {
      const student = studentOrName.lesson.student;
      const tutor = studentOrName.lesson.tutor;
      
      if (student && student.firstName) {
        return this.transform(student);
      }
      if (tutor && tutor.firstName) {
        return this.transform(tutor);
      }
    }

    // Fallback
    return 'Unknown';
  }
}

